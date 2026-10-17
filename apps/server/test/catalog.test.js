import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { UserRole, BufferPlacement } from '@slotify/shared';

/**
 * Register a fresh owner, verify their email, log in, and create a business.
 * @param {import('supertest').SuperTest<import('supertest').Test>} app
 * @param {string} email
 * @param {string} slug
 * @returns {Promise<{ token: string, businessId: string }>}
 */
async function createOwnerWithBusiness(app, email, slug) {
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

  const bizRes = await request(app)
    .post('/api/v1/businesses')
    .set('Authorization', `Bearer ${loginRes.body.data.sessionToken}`)
    .send({
      name: 'Biz',
      slug,
      category: 'spa',
      timeZone: 'UTC',
      location: { address: 'Street 1', city: 'Berlin', country: 'Germany' },
    })
    .expect(201);

  return {
    token: loginRes.body.data.sessionToken,
    businessId: bizRes.body.data.business.id,
  };
}

describe('Service & Staff Catalog API Integration Tests', { concurrency: 1 }, () => {
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
    await db.collection('services').deleteMany({});
    await db.collection('staff').deleteMany({});
  });

  describe('Service routes', () => {
    it('creates a service with defaults for the owning business', async () => {
      const { token, businessId } = await createOwnerWithBusiness(
        app,
        'svc-owner@example.com',
        'svc-biz'
      );

      const res = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Massage', durationMinutes: 60, price: 50 })
        .expect(201);

      assert.equal(res.body.data.service.name, 'Massage');
      assert.equal(res.body.data.service.durationMinutes, 60);
      assert.equal(res.body.data.service.bufferMinutes, 0);
      assert.equal(res.body.data.service.bufferPlacement, BufferPlacement.AFTER);
      assert.equal(res.body.data.service.active, true);
      assert.deepEqual(res.body.data.service.eligibleStaffIds, []);
    });

    it('rejects service creation by another owner (cross-tenant 403)', async () => {
      const { businessId } = await createOwnerWithBusiness(app, 'a-owner@example.com', 'a-biz');
      const { token: otherToken } = await createOwnerWithBusiness(
        app,
        'b-owner@example.com',
        'b-biz'
      );

      const res = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Massage', durationMinutes: 60 })
        .expect(403);

      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('rejects eligibleStaffIds referencing staff of another business (400)', async () => {
      const { token, businessId } = await createOwnerWithBusiness(
        app,
        'svc-owner@example.com',
        'svc-biz'
      );
      const { businessId: otherBusinessId, token: otherToken } = await createOwnerWithBusiness(
        app,
        'other-owner@example.com',
        'other-biz'
      );

      // Create a staff record in the OTHER business to steal its id
      const staffRes = await request(app)
        .post(`/api/v1/businesses/${otherBusinessId}/staff`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ displayName: 'Foreign Staff' })
        .expect(201);
      const foreignStaffId = staffRes.body.data.staff.id;

      const res = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Massage', durationMinutes: 60, eligibleStaffIds: [foreignStaffId] })
        .expect(400);

      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.match(res.body.error.message, /do not belong to this business/);
    });

    it('lists, updates, and deactivates a service', async () => {
      const { token, businessId } = await createOwnerWithBusiness(
        app,
        'svc-owner@example.com',
        'svc-biz'
      );

      const createRes = await request(app)
        .post(`/api/v1/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Massage', durationMinutes: 60 })
        .expect(201);
      const serviceId = createRes.body.data.service.id;

      const listRes = await request(app)
        .get(`/api/v1/businesses/${businessId}/services`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(listRes.body.data.services.length, 1);

      const patchRes = await request(app)
        .patch(`/api/v1/businesses/${businessId}/services/${serviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ price: 75, description: 'Deep tissue' })
        .expect(200);
      assert.equal(patchRes.body.data.service.price, 75);

      const delRes = await request(app)
        .delete(`/api/v1/businesses/${businessId}/services/${serviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(delRes.body.data.service.active, false);

      // Record still retrievable (soft delete)
      const getRes = await request(app)
        .get(`/api/v1/businesses/${businessId}/services/${serviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(getRes.body.data.service.active, false);
    });

    it('returns 404 for a service of a different business id', async () => {
      const { token, businessId } = await createOwnerWithBusiness(
        app,
        'svc-owner@example.com',
        'svc-biz'
      );
      const { businessId: otherBusinessId, token: otherToken } = await createOwnerWithBusiness(
        app,
        'other-owner@example.com',
        'other-biz'
      );

      const createRes = await request(app)
        .post(`/api/v1/businesses/${otherBusinessId}/services`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Foreign Service', durationMinutes: 30 })
        .expect(201);
      const foreignServiceId = createRes.body.data.service.id;

      await request(app)
        .get(`/api/v1/businesses/${businessId}/services/${foreignServiceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('Staff routes', () => {
    it('creates a staff record with defaults (owner-managed, no login)', async () => {
      const { token, businessId } = await createOwnerWithBusiness(
        app,
        'staff-owner@example.com',
        'staff-biz'
      );

      const res = await request(app)
        .post(`/api/v1/businesses/${businessId}/staff`)
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Anna Masseuse', qualifications: ['massage'] })
        .expect(201);

      assert.equal(res.body.data.staff.displayName, 'Anna Masseuse');
      assert.equal(res.body.data.staff.active, true);
      assert.deepEqual(res.body.data.staff.shifts, []);
      assert.deepEqual(res.body.data.staff.breaks, []);
      assert.deepEqual(res.body.data.staff.leave, []);
    });

    it('rejects staff creation by another owner (cross-tenant 403)', async () => {
      const { businessId } = await createOwnerWithBusiness(app, 'a-owner@example.com', 'a-biz');
      const { token: otherToken } = await createOwnerWithBusiness(
        app,
        'b-owner@example.com',
        'b-biz'
      );

      const res = await request(app)
        .post(`/api/v1/businesses/${businessId}/staff`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ displayName: 'Injected Staff' })
        .expect(403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('lists, updates, and deactivates staff', async () => {
      const { token, businessId } = await createOwnerWithBusiness(
        app,
        'staff-owner@example.com',
        'staff-biz'
      );

      const createRes = await request(app)
        .post(`/api/v1/businesses/${businessId}/staff`)
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Anna Masseuse' })
        .expect(201);
      const staffId = createRes.body.data.staff.id;

      const listRes = await request(app)
        .get(`/api/v1/businesses/${businessId}/staff`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(listRes.body.data.staff.length, 1);

      const patchRes = await request(app)
        .patch(`/api/v1/businesses/${businessId}/staff/${staffId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }],
        })
        .expect(200);
      assert.equal(patchRes.body.data.staff.shifts.length, 1);
      assert.equal(patchRes.body.data.staff.shifts[0].day, 'monday');

      const delRes = await request(app)
        .delete(`/api/v1/businesses/${businessId}/staff/${staffId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(delRes.body.data.staff.active, false);
    });

    it('rejects an invalid shift payload with 400', async () => {
      const { token, businessId } = await createOwnerWithBusiness(
        app,
        'staff-owner@example.com',
        'staff-biz'
      );

      const createRes = await request(app)
        .post(`/api/v1/businesses/${businessId}/staff`)
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Anna Masseuse' })
        .expect(201);
      const staffId = createRes.body.data.staff.id;

      await request(app)
        .patch(`/api/v1/businesses/${businessId}/staff/${staffId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ shifts: [{ day: 'funday', windows: [] }] })
        .expect(400);
    });
  });
});
