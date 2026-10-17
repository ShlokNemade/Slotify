import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';

describe('Password Reset API Integration Tests', { concurrency: 1 }, () => {
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
    await db.collection('users').deleteMany({});
    await db.collection('sessions').deleteMany({});
    await db.collection('outbox').deleteMany({});
  });

  const registerUser = async (email) =>
    request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'OriginalPassword123!',
        fullName: 'Reset Tester',
      })
      .expect(201);

  describe('POST /api/v1/auth/request-password-reset', () => {
    it('returns sent:true and queues an outbox event for an existing account', async () => {
      await registerUser('reset@example.com');

      const res = await request(app)
        .post('/api/v1/auth/request-password-reset')
        .send({ email: 'reset@example.com' })
        .expect(200);

      assert.equal(res.body.success, true);
      assert.equal(res.body.data.sent, true);
      assert.ok(res.body.data.devResetToken);

      const outboxEvent = await db.collection('outbox').findOne({
        'payload.email': 'reset@example.com',
        eventType: 'user.password_reset_requested',
      });
      assert.ok(outboxEvent);
      assert.equal(outboxEvent.eventType, 'user.password_reset_requested');

      const user = await db.collection('users').findOne({ email: 'reset@example.com' });
      assert.ok(user.passwordResetTokenHash);
      assert.ok(user.passwordResetExpiresAt > new Date());
    });

    it('returns the same non-enumerating response for an unknown email and queues nothing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/request-password-reset')
        .send({ email: 'ghost@example.com' })
        .expect(200);

      assert.equal(res.body.success, true);
      assert.equal(res.body.data.sent, true);
      assert.equal(res.body.data.devResetToken, undefined);

      const outboxCount = await db.collection('outbox').countDocuments();
      assert.equal(outboxCount, 0);
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('resets the password, revokes existing sessions, and clears the token', async () => {
      await registerUser('reset@example.com');

      const reqRes = await request(app)
        .post('/api/v1/auth/request-password-reset')
        .send({ email: 'reset@example.com' })
        .expect(200);
      const token = reqRes.body.data.devResetToken;

      // Establish a session that must be revoked by the reset
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'reset@example.com', password: 'OriginalPassword123!' })
        .expect(200);
      const sessionCookie = loginRes.headers['set-cookie'];

      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'BrandNewPassword123!' })
        .expect(200);

      assert.equal(resetRes.body.success, true);

      // Old password no longer works
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'reset@example.com', password: 'OriginalPassword123!' })
        .expect(401);

      // New password works
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'reset@example.com', password: 'BrandNewPassword123!' })
        .expect(200);

      // Pre-existing session was revoked
      await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie).expect(401);

      // Token is single-use: cleared from the user record
      const user = await db.collection('users').findOne({ email: 'reset@example.com' });
      assert.equal(user.passwordResetTokenHash, undefined);
      assert.equal(user.passwordResetExpiresAt, undefined);
    });

    it('rejects an invalid token with 400 Validation Error', async () => {
      await registerUser('reset@example.com');

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'ffffffffffffffffffffffffffffffff', newPassword: 'BrandNewPassword123!' })
        .expect(400);

      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('rejects token reuse (single-use) with 400', async () => {
      await registerUser('reset@example.com');

      const reqRes = await request(app)
        .post('/api/v1/auth/request-password-reset')
        .send({ email: 'reset@example.com' })
        .expect(200);
      const token = reqRes.body.data.devResetToken;

      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'FirstResetPassword123!' })
        .expect(200);

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'SecondResetPassword123!' })
        .expect(400);

      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });
});
