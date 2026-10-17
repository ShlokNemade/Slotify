import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { UserRole, BusinessStatus } from '@slotify/shared';

const VALID_BUSINESS = {
  name: 'Serenity Spa',
  slug: 'serenity-spa',
  description: 'A calm place',
  category: 'spa',
  timeZone: 'Europe/Berlin',
  location: {
    address: 'Wallstrasse 12',
    city: 'Berlin',
    country: 'Germany',
  },
};

/**
 * Register a fresh owner, verify their email, and log in.
 * @param {import('supertest').SuperTest<import('supertest').Test>} app
 * @param {string} email
 * @returns {Promise<{ token: string }>} bearer token for API calls
 */
async function createVerifiedOwner(app, email) {
  const regRes = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email,
      password: 'StrongPassword123!',
      fullName: 'Owner',
      role: UserRole.OWNER,
    })
    .expect(201);

  await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ token: regRes.body.data.devVerificationToken })
    .expect(200);

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'StrongPassword123!' })
    .expect(200);

  return { token: loginRes.body.data.sessionToken };
}

describe('Business Setup API Integration Tests', { concurrency: 1 }, () => {
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
    await db.collection('businesses').deleteMany({});
  });

  describe('POST /api/v1/businesses', () => {
    it('creates a draft business for a verified owner with defaults', async () => {
      const { token } = await createVerifiedOwner(app, 'owner@example.com');

      const res = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send(VALID_BUSINESS)
        .expect(201);

      assert.equal(res.body.success, true);
      assert.equal(res.body.data.business.slug, 'serenity-spa');
      assert.equal(res.body.data.business.status, BusinessStatus.DRAFT);
      assert.equal(res.body.data.business.timeZone, 'Europe/Berlin');
      assert.equal(res.body.data.business.defaultSlotIntervalMinutes, 30);
      assert.equal(res.body.data.business.minNoticeHours, 2);
      assert.equal(res.body.data.business.maxHorizonDays, 60);
      assert.equal(res.body.data.business.hours.monday.isOpen, false);
      assert.equal(res.body.data.business.reviewNotes, null);
    });

    it('rejects business creation by an unverified owner (403)', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'unverified@example.com',
          password: 'StrongPassword123!',
          fullName: 'Owner',
          role: UserRole.OWNER,
        })
        .expect(201);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'unverified@example.com', password: 'StrongPassword123!' })
        .expect(200);

      const res = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${loginRes.body.data.sessionToken}`)
        .send(VALID_BUSINESS)
        .expect(403);

      assert.match(res.body.error.message, /Email verification required/);
    });

    it('rejects business creation by a customer (403)', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'customer@example.com',
          password: 'StrongPassword123!',
          fullName: 'Customer',
          role: UserRole.CUSTOMER,
        })
        .expect(201);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'customer@example.com', password: 'StrongPassword123!' })
        .expect(200);

      const res = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${loginRes.body.data.sessionToken}`)
        .send(VALID_BUSINESS)
        .expect(403);

      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('rejects a duplicate slug with 409 Conflict', async () => {
      const { token } = await createVerifiedOwner(app, 'owner1@example.com');
      await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send(VALID_BUSINESS)
        .expect(201);

      const { token: token2 } = await createVerifiedOwner(app, 'owner2@example.com');
      const res = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token2}`)
        .send(VALID_BUSINESS)
        .expect(409);

      assert.equal(res.body.error.code, 'CONFLICT');
    });

    it('rejects an invalid payload with 400 Validation Error', async () => {
      const { token } = await createVerifiedOwner(app, 'owner@example.com');

      const res = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...VALID_BUSINESS, slug: 'Bad Slug!' })
        .expect(400);

      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/businesses/:businessId', () => {
    it('allows the owner to read their own business', async () => {
      const { token } = await createVerifiedOwner(app, 'owner@example.com');
      const createRes = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send(VALID_BUSINESS)
        .expect(201);
      const businessId = createRes.body.data.business.id;

      const res = await request(app)
        .get(`/api/v1/businesses/${businessId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.business.slug, 'serenity-spa');
    });

    it('rejects cross-tenant reads with 403', async () => {
      const { token: owner1Token } = await createVerifiedOwner(app, 'owner1@example.com');
      const createRes = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${owner1Token}`)
        .send(VALID_BUSINESS)
        .expect(201);
      const businessId = createRes.body.data.business.id;

      const { token: owner2Token } = await createVerifiedOwner(app, 'owner2@example.com');
      const res = await request(app)
        .get(`/api/v1/businesses/${businessId}`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .expect(403);

      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('returns 404 for an unknown business id', async () => {
      const { token } = await createVerifiedOwner(app, 'owner@example.com');
      const res = await request(app)
        .get('/api/v1/businesses/aaaaaaaaaaaaaaaaaaaaaaaa')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/businesses/:businessId', () => {
    it('updates profile fields and hours', async () => {
      const { token } = await createVerifiedOwner(app, 'owner@example.com');
      const createRes = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send(VALID_BUSINESS)
        .expect(201);
      const businessId = createRes.body.data.business.id;

      const res = await request(app)
        .patch(`/api/v1/businesses/${businessId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Updated description',
          hours: {
            monday: { isOpen: true, windows: [{ open: '09:00', close: '17:00' }] },
          },
        })
        .expect(200);

      assert.equal(res.body.data.business.description, 'Updated description');
      assert.equal(res.body.data.business.hours.monday.isOpen, true);
      assert.deepEqual(res.body.data.business.hours.monday.windows, [
        { open: '09:00', close: '17:00' },
      ]);
      assert.equal(res.body.data.business.hours.tuesday.isOpen, false);

      // Persisted
      const stored = await db.collection('businesses').findOne({
        _id: new ObjectId(createRes.body.data.business.id),
      });
      assert.equal(stored.description, 'Updated description');
    });

    it('changes the slug to a free slug', async () => {
      const { token } = await createVerifiedOwner(app, 'owner@example.com');
      const createRes = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send(VALID_BUSINESS)
        .expect(201);
      const businessId = createRes.body.data.business.id;

      const res = await request(app)
        .patch(`/api/v1/businesses/${businessId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ slug: 'serenity-spa-berlin' })
        .expect(200);

      assert.equal(res.body.data.business.slug, 'serenity-spa-berlin');
    });

    it('rejects changing the slug to one that already exists (409)', async () => {
      const { token: owner1Token } = await createVerifiedOwner(app, 'owner1@example.com');
      await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${owner1Token}`)
        .send(VALID_BUSINESS)
        .expect(201);

      const { token: owner2Token } = await createVerifiedOwner(app, 'owner2@example.com');
      const createRes = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${owner2Token}`)
        .send({ ...VALID_BUSINESS, slug: 'other-spa' })
        .expect(201);
      const businessId = createRes.body.data.business.id;

      const res = await request(app)
        .patch(`/api/v1/businesses/${businessId}`)
        .set('Authorization', `Bearer ${owner2Token}`)
        .send({ slug: 'serenity-spa' })
        .expect(409);

      assert.equal(res.body.error.code, 'CONFLICT');
    });

    it('rejects an invalid update payload with 400', async () => {
      const { token } = await createVerifiedOwner(app, 'owner@example.com');
      const createRes = await request(app)
        .post('/api/v1/businesses')
        .set('Authorization', `Bearer ${token}`)
        .send(VALID_BUSINESS)
        .expect(201);
      const businessId = createRes.body.data.business.id;

      await request(app)
        .patch(`/api/v1/businesses/${businessId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ minNoticeHours: 99999 })
        .expect(400);
    });
  });
});
