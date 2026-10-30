import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { bootstrapAdmin } from '../src/services/admin-service.js';
import { submitBusinessForReview } from '../src/services/business-service.js';
import { UserRole, BusinessStatus } from '@slotify/shared';
import { ObjectId } from 'mongodb';

const DAY_BUSINESS = {
  name: 'Slot Spa',
  slug: 'slot-spa',
  category: 'spa',
  timeZone: 'UTC',
  location: { address: 'Street 1', city: 'Berlin', country: 'Germany' },
};

let ownerToken;
let businessId;
let serviceId;

async function registerLogin(app, email) {
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'StrongPassword123!', fullName: 'Owner', role: UserRole.OWNER })
    .expect(201);
  await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ token: reg.body.data.devVerificationToken })
    .expect(200);
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'StrongPassword123!' })
    .expect(200);
  return login.body.data.sessionToken;
}

describe('Availability Slots API Integration Tests', { concurrency: 1 }, () => {
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
    for (const coll of ['users', 'sessions', 'outbox', 'businesses', 'services', 'staff', 'audit_events', 'bookings', 'availability_exceptions']) {
      await db.collection(coll).deleteMany({});
    }
    await bootstrapAdmin({
      email: 'admin@slotify.internal',
      password: 'AdminBootstrapPassword!',
    });

    ownerToken = await registerLogin(app, 'slots-owner@example.com');
    const biz = await request(app)
      .post('/api/v1/businesses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(DAY_BUSINESS)
      .expect(201);
    businessId = biz.body.data.business.id;

    // Monday 09:00-17:00 business hours (recurring) + staff shift.
    await request(app)
      .patch(`/api/v1/businesses/${businessId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ hours: { monday: { isOpen: true, windows: [{ open: '09:00', close: '17:00' }] } } })
      .expect(200);

    const svc = await request(app)
      .post(`/api/v1/businesses/${businessId}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Massage', durationMinutes: 60 })
      .expect(201);
    serviceId = svc.body.data.service.id;

    await request(app)
      .post(`/api/v1/businesses/${businessId}/staff`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        displayName: 'Anna',
        shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }],
      })
      .expect(201);

    // Publish the business (approve flow) for the public slots endpoint.
    await submitBusinessForReview(businessId);
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@slotify.internal', password: 'AdminBootstrapPassword!' })
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/businesses/${businessId}/review`)
      .set('Authorization', `Bearer ${adminLogin.body.data.sessionToken}`)
      .send({ status: BusinessStatus.APPROVED, notes: 'ok' })
      .expect(200);
  });

  it('owner preview returns grid slots for the service on a scheduled Monday', async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${businessId}/availability?serviceId=${serviceId}&fromDate=2026-11-02&toDate=2026-11-02`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const data = res.body.data;
    assert.equal(data.timeZone, 'UTC');
    assert.equal(data.slotIntervalMinutes, 30);
    assert.deepEqual(data.range, { fromDate: '2026-11-02', toDate: '2026-11-02' });
    assert.equal(data.staff.length, 1);
    assert.equal(data.staff[0].slots.length, 15); // 09:00..16:00 step 30
    assert.equal(data.staff[0].slots[0], new Date('2026-11-02T09:00:00Z').toISOString());
    assert.deepEqual(data.anyStaffSlots, data.staff[0].slots);
  });

  it('owner preview resolves a closure exception to zero slots', async () => {
    await request(app)
      .post(`/api/v1/businesses/${businessId}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date: '2026-11-02', isOpen: false, reason: 'Holiday' })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/businesses/${businessId}/availability?serviceId=${serviceId}&fromDate=2026-11-02&toDate=2026-11-02`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    assert.equal(res.body.data.staff[0].slots.length, 0);
  });

  it('a business-wide instant block removes the crossing slots', async () => {
    await request(app)
      .post(`/api/v1/businesses/${businessId}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ startDateTime: '2026-11-02T11:00:00Z', endDateTime: '2026-11-02T12:00:00Z', reason: 'Break' })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/businesses/${businessId}/availability?serviceId=${serviceId}&fromDate=2026-11-02&toDate=2026-11-02`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const slots = res.body.data.staff[0].slots;
    assert.equal(slots.includes('2026-11-02T10:30:00.000Z'), false); // 10:30+60min crosses the block
    assert.equal(slots.includes('2026-11-02T12:00:00.000Z'), true);
    assert.equal(slots.includes('2026-11-02T10:00:00.000Z'), true);
  });

  it('requires ownership (other owner 403), valid service (404), sane range (400)', async () => {
    const other = await registerLogin(app, 'slots-other@example.com');
    await request(app)
      .get(`/api/v1/businesses/${businessId}/availability?serviceId=${serviceId}&fromDate=2026-11-02&toDate=2026-11-02`)
      .set('Authorization', `Bearer ${other}`)
      .expect(403);

    await request(app)
      .get(`/api/v1/businesses/${businessId}/availability?serviceId=${new ObjectId().toString()}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    await request(app)
      .get(`/api/v1/businesses/${businessId}/availability?serviceId=${serviceId}&fromDate=2026-11-20&toDate=2026-11-02`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  it('public slots endpoint works for approved businesses and merges any-staff', async () => {
    const res = await request(app)
      .get(`/api/v1/directory/businesses/slot-spa/slots?serviceId=${serviceId}&fromDate=2026-11-02&toDate=2026-11-02`)
      .expect(200);
    const data = res.body.data;
    assert.equal(data.timeZone, 'UTC');
    assert.equal(data.anyStaffSlots.length, 15);
    assert.equal(data.range.fromDate, '2026-11-02');
    // No internal staff schedule templates are exposed on the public profile.
    const staffRes = await request(app)
      .get('/api/v1/directory/businesses/slot-spa')
      .expect(200);
    assert.equal(staffRes.body.data.business.staff[0].shifts, undefined);
  });

  it('public slots endpoint 404s for draft businesses (no existence leak)', async () => {
    const other = await registerLogin(app, 'slots-draft@example.com');
    const biz = await request(app)
      .post('/api/v1/businesses')
      .set('Authorization', `Bearer ${other}`)
      .send({ ...DAY_BUSINESS, name: 'Draft Slot Spa', slug: 'draft-slot-spa' })
      .expect(201);
    const draftId = biz.body.data.business.id;
    const svc = await request(app)
      .post(`/api/v1/businesses/${draftId}/services`)
      .set('Authorization', `Bearer ${other}`)
      .send({ name: 'Massage', durationMinutes: 60 })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/directory/businesses/draft-slot-spa/slots?serviceId=${svc.body.data.service.id}&fromDate=2026-11-02&toDate=2026-11-02`)
      .expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('public slots endpoint rejects invalid queries with 400', async () => {
    await request(app)
      .get(`/api/v1/directory/businesses/slot-spa/slots?serviceId=${serviceId}&fromDate=2026-11-20&toDate=2026-11-02`)
      .expect(400);
    await request(app)
      .get(`/api/v1/directory/businesses/slot-spa/slots?serviceId=nonsense`)
      .expect(400);
  });
});
