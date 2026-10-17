import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { bootstrapAdmin } from '../src/services/admin-service.js';
import { submitBusinessForReview } from '../src/services/business-service.js';
import { UserRole, BusinessStatus } from '@slotify/shared';

const VALID_BUSINESS = {
  name: 'Review Spa',
  slug: 'review-spa',
  category: 'spa',
  timeZone: 'UTC',
  location: { address: 'Street 1', city: 'Berlin', country: 'Germany' },
};

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
    .send({ ...VALID_BUSINESS, slug })
    .expect(201);

  return {
    token: loginRes.body.data.sessionToken,
    businessId: bizRes.body.data.business.id,
  };
}

/**
 * Create a platform admin via the bootstrap service and log in.
 * @param {import('supertest').SuperTest<import('supertest').Test>} app
 * @returns {Promise<string>} admin bearer token
 */
async function createAdmin(app) {
  const { adminId } = await bootstrapAdmin({
    email: 'admin@slotify.internal',
    password: 'AdminBootstrapPassword!',
  });

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@slotify.internal', password: 'AdminBootstrapPassword!' })
    .expect(200);

  assert.equal(loginRes.body.data.user.role, UserRole.PLATFORM_ADMIN);
  return adminId ? loginRes.body.data.sessionToken : loginRes.body.data.sessionToken;
}

describe('Admin Tenant Review API Integration Tests', { concurrency: 1 }, () => {
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
    await db.collection('audit_events').deleteMany({});
  });

  it('bootstraps an admin idempotently (created once, then updated without error)', async () => {
    const first = await bootstrapAdmin({
      email: 'admin@slotify.internal',
      password: 'AdminBootstrapPassword!',
    });
    const second = await bootstrapAdmin({
      email: 'admin@slotify.internal',
      password: 'AdminBootstrapPassword!',
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.adminId, second.adminId);

    const admin = await db
      .collection('users')
      .findOne({ _id: new ObjectId(first.adminId) });
    assert.equal(admin.role, UserRole.PLATFORM_ADMIN);
    assert.equal(admin.isEmailVerified, true);
  });

  it('rejects admin routes for owners and customers (403)', async () => {
    const { token: ownerToken } = await createOwnerWithBusiness(
      app,
      'owner@example.com',
      'owner-biz'
    );

    const res = await request(app)
      .get('/api/v1/admin/businesses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN');

    await request(app).get('/api/v1/admin/businesses').expect(401);
  });

  it('lists pending businesses for the admin', async () => {
    const { businessId } = await createOwnerWithBusiness(app, 'owner@example.com', 'owner-biz');
    await submitBusinessForReview(businessId);

    const token = await createAdmin(app);
    const res = await request(app)
      .get('/api/v1/admin/businesses?status=pending_approval')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.data.total, 1);
    assert.equal(res.body.data.businesses[0].slug, 'owner-biz');
    assert.equal(res.body.data.businesses[0].status, BusinessStatus.PENDING_APPROVAL);
  });

  it('approves a business with audit and outbox records', async () => {
    const { businessId } = await createOwnerWithBusiness(app, 'owner@example.com', 'owner-biz');
    await submitBusinessForReview(businessId);

    const token = await createAdmin(app);
    const res = await request(app)
      .post(`/api/v1/admin/businesses/${businessId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: BusinessStatus.APPROVED, notes: 'Looks good' })
      .expect(200);

    assert.equal(res.body.data.business.status, BusinessStatus.APPROVED);
    assert.equal(res.body.data.business.reviewNotes, 'Looks good');
    assert.ok(res.body.data.business.reviewedAt);

    const audit = await db
      .collection('audit_events')
      .findOne({ targetId: new ObjectId(businessId) });
    assert.ok(audit);
    assert.equal(audit.action, 'business.approved');
    assert.equal(audit.scope, 'platform');
    assert.equal(audit.metadata.newStatus, BusinessStatus.APPROVED);

    const outbox = await db
      .collection('outbox')
      .findOne({ 'payload.businessId': businessId });
    assert.ok(outbox);
    assert.equal(outbox.eventType, 'business.approved');
  });

  it('rejects a business without notes (400) and with notes (status rejected)', async () => {
    const { businessId } = await createOwnerWithBusiness(app, 'owner@example.com', 'owner-biz');
    await submitBusinessForReview(businessId);

    const token = await createAdmin(app);

    const noNotes = await request(app)
      .post(`/api/v1/admin/businesses/${businessId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: BusinessStatus.REJECTED, notes: '' })
      .expect(400);
    assert.equal(noNotes.body.error.code, 'VALIDATION_ERROR');

    const rejected = await request(app)
      .post(`/api/v1/admin/businesses/${businessId}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: BusinessStatus.REJECTED, notes: 'Incomplete profile' })
      .expect(200);
    assert.equal(rejected.body.data.business.status, BusinessStatus.REJECTED);
  });

  it('allows the owner to resubmit a rejected business for re-review', async () => {
    const { token, businessId } = await createOwnerWithBusiness(
      app,
      'owner@example.com',
      'owner-biz'
    );
    await submitBusinessForReview(businessId);

    const token2 = await createAdmin(app);
    const rejected = await request(app)
      .post(`/api/v1/admin/businesses/${businessId}/review`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ status: BusinessStatus.REJECTED, notes: 'Needs hours' })
      .expect(200);
    assert.equal(rejected.body.data.business.status, BusinessStatus.REJECTED);

    // Explicit resubmission from rejected → pending_approval
    await submitBusinessForReview(businessId);
    let stored = await db.collection('businesses').findOne({
      _id: new ObjectId(businessId),
    });
    assert.equal(stored.status, BusinessStatus.PENDING_APPROVAL);

    // Reject again, then verify the owner PATCH auto-resubmits
    await request(app)
      .post(`/api/v1/admin/businesses/${businessId}/review`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ status: BusinessStatus.REJECTED, notes: 'Still needs hours' })
      .expect(200);

    // Owner edits the profile; status resubmits automatically
    const patchRes = await request(app)
      .patch(`/api/v1/businesses/${businessId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Fixed profile' })
      .expect(200);
    assert.equal(patchRes.body.data.business.status, BusinessStatus.PENDING_APPROVAL);

    // Submitting while already pending_approval is rejected with 400
    await assert.rejects(
      () => submitBusinessForReview(businessId),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });
});
