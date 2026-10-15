import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { UserRole } from '@slotify/shared';

describe('Authentication & Session API Integration Tests', { concurrency: 1 }, () => {
  let app;
  let db;

  before(async () => {
    const mongo = await connectMongo();
    db = mongo.db;
    app = createApp();
  });

  after(async () => {
    await closeMongo();
  });

  beforeEach(async () => {
    // Clean up test collections before each test run
    await db.collection('users').deleteMany({});
    await db.collection('sessions').deleteMany({});
    await db.collection('outbox').deleteMany({});
  });

  describe('POST /api/v1/auth/register', () => {
    it('successfully registers a customer and creates outbox event', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'alice@example.com',
          password: 'Password123!',
          fullName: 'Alice Smith',
          role: UserRole.CUSTOMER,
        })
        .expect(201);

      assert.equal(res.body.success, true);
      assert.equal(res.body.data.user.email, 'alice@example.com');
      assert.equal(res.body.data.user.isEmailVerified, false);
      assert.ok(res.body.data.devVerificationToken);

      // Verify outbox record created
      const outboxEvent = await db.collection('outbox').findOne({
        'payload.email': 'alice@example.com',
      });
      assert.ok(outboxEvent);
      assert.equal(outboxEvent.eventType, 'user.verification_requested');
    });

    it('rejects duplicate email with 409 Conflict', async () => {
      const payload = {
        email: 'alice@example.com',
        password: 'Password123!',
        fullName: 'Alice Smith',
      };

      await request(app).post('/api/v1/auth/register').send(payload).expect(201);
      const res = await request(app).post('/api/v1/auth/register').send(payload).expect(409);

      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'CONFLICT');
    });

    it('rejects short passwords with 400 Validation Error', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'short@example.com',
          password: 'short',
          fullName: 'Short Pwd',
        })
        .expect(400);

      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('verifies user email using valid verification token', async () => {
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'bob@example.com',
          password: 'Password123!',
          fullName: 'Bob Johnson',
        })
        .expect(201);

      const token = regRes.body.data.devVerificationToken;

      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token })
        .expect(200);

      assert.equal(verifyRes.body.success, true);

      // Verify DB record updated
      const user = await db.collection('users').findOne({ email: 'bob@example.com' });
      assert.equal(user.isEmailVerified, true);
      assert.equal(user.accountStatus, 'active');
      assert.equal(user.verificationTokenHash, undefined);
    });

    it('rejects invalid verification tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: '00000000000000000000000000000000' })
        .expect(400);

      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login and Session Management', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'claire@example.com',
          password: 'StrongPassword123!',
          fullName: 'Claire Redfield',
          role: UserRole.OWNER,
        })
        .expect(201);
    });

    it('authenticates user, returns session token and sets HttpOnly cookie', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'claire@example.com',
          password: 'StrongPassword123!',
        })
        .expect(200);

      assert.equal(res.body.success, true);
      assert.ok(res.body.data.sessionToken);
      assert.equal(res.body.data.user.email, 'claire@example.com');

      // Check cookie header
      const cookies = res.headers['set-cookie'];
      assert.ok(cookies);
      assert.ok(cookies.some((c) => c.includes('slotify_session=')));
      assert.ok(cookies.some((c) => c.includes('HttpOnly')));
    });

    it('rejects incorrect password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'claire@example.com',
          password: 'WrongPassword!',
        })
        .expect(401);

      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('retrieves user profile via /me with cookie session and logs out', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'claire@example.com',
          password: 'StrongPassword123!',
        })
        .expect(200);

      const sessionCookie = loginRes.headers['set-cookie'];

      // Access /me with session cookie
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', sessionCookie)
        .expect(200);

      assert.equal(meRes.body.success, true);
      assert.equal(meRes.body.data.user.email, 'claire@example.com');
      assert.equal(meRes.body.data.user.role, UserRole.OWNER);

      // Logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', sessionCookie)
        .expect(200);

      assert.equal(logoutRes.body.success, true);

      // Subsequent /me request should fail
      await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie).expect(401);
    });

    it('rejects unauthenticated requests to /me', async () => {
      const res = await request(app).get('/api/v1/auth/me').expect(401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });
  });
});
