import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { bootstrapAdmin } from '../src/services/admin-service.js';
import { submitBusinessForReview } from '../src/services/business-service.js';
import { UserRole, BusinessStatus } from '@slotify/shared';

const BASE_BUSINESS = {
  name: 'Public Spa',
  category: 'spa',
  timeZone: 'UTC',
  location: { address: 'Street 1', city: 'Berlin', country: 'Germany' },
};

/**
 * Register a fresh owner, verify, log in, create a business, submit for review,
 * and (optionally) have the admin approve it. Optionally adds services/staff.
 * @param {import('supertest').SuperTest<import('supertest').Test>} app
 * @param {object} options
 * @returns {Promise<{ token: string, businessId: string, serviceIds: string[] }>}
 */
async function createPublishedBusiness(app, { slug, name = 'Public Spa', approve = true, withService = true, price = 50, category = 'spa', city = 'Berlin' } = {}) {
  const regRes = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email: `${slug}@example.com`,
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
    .send({ email: `${slug}@example.com`, password: 'StrongPassword123!' })
    .expect(200);
  const token = loginRes.body.data.sessionToken;

  const bizRes = await request(app)
    .post('/api/v1/businesses')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...BASE_BUSINESS, name, slug, category, location: { ...BASE_BUSINESS.location, city } })
    .expect(201);
  const businessId = bizRes.body.data.business.id;

  let serviceIds = [];
  if (withService) {
    const svcRes = await request(app)
      .post(`/api/v1/businesses/${businessId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Signature Treatment', durationMinutes: 60, price })
      .expect(201);
    serviceIds.push(svcRes.body.data.service.id);
  }

  if (approve) {
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
  }

  return { token, businessId, serviceIds };
}

describe('Public Directory & Profile API Integration Tests', { concurrency: 1 }, () => {
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
    await db.collection('audit_events').deleteMany({});
    // Admin needed for approvals
    await bootstrapAdmin({
      email: 'admin@slotify.internal',
      password: 'AdminBootstrapPassword!',
    });
  });

  it('lists only approved businesses with allowlisted fields', async () => {
    await createPublishedBusiness(app, { slug: 'approved-spa', name: 'Approved Spa' });
    await createPublishedBusiness(app, { slug: 'draft-spa', name: 'Draft Spa', approve: false });

    const res = await request(app)
      .get('/api/v1/directory/businesses')
      .expect(200);

    assert.equal(res.body.data.total, 1);
    const biz = res.body.data.businesses[0];
    assert.equal(biz.slug, 'approved-spa');
    // Allowlist: no ownerId, status, reviewNotes, or full address
    assert.equal(biz.ownerId, undefined);
    assert.equal(biz.status, undefined);
    assert.equal(biz.reviewNotes, undefined);
    assert.equal(biz.location, undefined);
    assert.equal(biz.city, 'Berlin');
  });

  it('excludes approved businesses without any active service (incomplete)', async () => {
    await createPublishedBusiness(app, { slug: 'empty-spa', withService: false });

    const res = await request(app)
      .get('/api/v1/directory/businesses')
      .expect(200);
    assert.equal(res.body.data.total, 0);
  });

  it('filters by category, city, search, and price range', async () => {
    await createPublishedBusiness(app, { slug: 'spa-berlin', category: 'spa', city: 'Berlin', price: 50 });
    await createPublishedBusiness(app, { slug: 'salon-munich', name: 'Munich Salon', category: 'salon', city: 'Munich', price: 120 });

    const byCategory = await request(app)
      .get('/api/v1/directory/businesses?category=spa')
      .expect(200);
    assert.equal(byCategory.body.data.total, 1);
    assert.equal(byCategory.body.data.businesses[0].slug, 'spa-berlin');

    const byCity = await request(app)
      .get('/api/v1/directory/businesses?city=munich')
      .expect(200);
    assert.equal(byCity.body.data.total, 1);
    assert.equal(byCity.body.data.businesses[0].slug, 'salon-munich');

    const bySearch = await request(app)
      .get('/api/v1/directory/businesses?search=munich')
      .expect(200);
    assert.equal(bySearch.body.data.total, 1);
    assert.equal(bySearch.body.data.businesses[0].slug, 'salon-munich');

    const byPrice = await request(app)
      .get('/api/v1/directory/businesses?maxPrice=60')
      .expect(200);
    assert.equal(byPrice.body.data.total, 1);
    assert.equal(byPrice.body.data.businesses[0].slug, 'spa-berlin');

    const noMatch = await request(app)
      .get('/api/v1/directory/businesses?minPrice=1000')
      .expect(200);
    assert.equal(noMatch.body.data.total, 0);
  });

  it('paginates directory results', async () => {
    await createPublishedBusiness(app, { slug: 'p-one', name: 'Alpha' });
    await createPublishedBusiness(app, { slug: 'p-two', name: 'Beta' });

    const page1 = await request(app)
      .get('/api/v1/directory/businesses?page=1&limit=1')
      .expect(200);
    assert.equal(page1.body.data.total, 2);
    assert.equal(page1.body.data.businesses.length, 1);
    assert.equal(page1.body.data.businesses[0].name, 'Alpha');

    const page2 = await request(app)
      .get('/api/v1/directory/businesses?page=2&limit=1')
      .expect(200);
    assert.equal(page2.body.data.businesses.length, 1);
    assert.equal(page2.body.data.businesses[0].name, 'Beta');
  });

  it('returns the public profile by slug with services and staff display names', async () => {
    const { token, businessId } = await createPublishedBusiness(app, { slug: 'profile-spa' });

    // Add staff for display-name projection
    await request(app)
      .post(`/api/v1/businesses/${businessId}/staff`)
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Anna Masseuse', shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }] })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/directory/businesses/profile-spa')
      .expect(200);

    const biz = res.body.data.business;
    assert.equal(biz.slug, 'profile-spa');
    assert.equal(biz.ownerId, undefined);
    assert.equal(biz.reviewNotes, undefined);
    assert.deepEqual(biz.hours.monday, { isOpen: false, windows: [] });
    assert.equal(biz.services.length, 1);
    assert.equal(biz.services[0].name, 'Signature Treatment');
    assert.equal(biz.services[0].price, 50);
    assert.equal(biz.staff.length, 1);
    assert.equal(biz.staff[0].displayName, 'Anna Masseuse');
    // No internal staff data exposed
    assert.equal(biz.staff[0].shifts, undefined);
    assert.equal(biz.staff[0].email, undefined);
  });

  it('returns 404 for draft businesses and unknown slugs (no existence leak)', async () => {
    await createPublishedBusiness(app, { slug: 'hidden-spa', approve: false });

    const draft = await request(app)
      .get('/api/v1/directory/businesses/hidden-spa')
      .expect(404);
    assert.equal(draft.body.error.code, 'NOT_FOUND');

    const unknown = await request(app)
      .get('/api/v1/directory/businesses/does-not-exist')
      .expect(404);
    assert.equal(unknown.body.error.code, 'NOT_FOUND');
  });

  it('rejects invalid query parameters with 400', async () => {
    const res = await request(app)
      .get('/api/v1/directory/businesses?page=0')
      .expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});
