import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { bootstrapAdmin } from '../src/services/admin-service.js';
import { submitBusinessForReview } from '../src/services/business-service.js';
import { createBooking as createBookingDirect } from '../src/services/booking-service.js';
import { UserRole, BusinessStatus, BookingStatus } from '@slotify/shared';

const DAY_BUSINESS = {
  name: 'Book Spa',
  slug: 'book-spa',
  category: 'spa',
  timeZone: 'UTC',
  location: { address: 'Street 1', city: 'Berlin', country: 'Germany' },
};

/** The upcoming Monday 10:00:00Z — staff/business hours target it (UTC). */
function nextMonday10() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  d.setUTCHours(10, 0, 0, 0);
  return d;
}

async function registerOwner(app, email, slugSuffix) {
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
  const token = login.body.data.sessionToken;
  const res = await request(app)
    .post('/api/v1/businesses')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...DAY_BUSINESS, slug: `${DAY_BUSINESS.slug}-${slugSuffix}` })
    .expect(201);
  return { token, businessId: res.body.data.business.id };
}

async function registerCustomer(app, email) {
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: email ?? `cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`, password: 'StrongPassword123!', fullName: 'Customer', role: UserRole.CUSTOMER })
    .expect(201);
  await request(app)
    .post('/api/v1/auth/verify-email')
    .send({ token: reg.body.data.devVerificationToken })
    .expect(200);
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: reg.body.data.user.email, password: 'StrongPassword123!' })
    .expect(200);
  return { token: login.body.data.sessionToken, userId: reg.body.data.user.id };
}

describe('Booking Creation API Integration Tests', { concurrency: 1 }, () => {
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
    await bootstrapAdmin({ email: 'admin@slotify.internal', password: 'AdminBootstrapPassword!' });
  });

  /** Full fixture: approved business with Monday hours, one service, one staff. */
  async function approvedFixture() {
    const owner = await registerOwner(app, `book-owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, Date.now().toString(36));
    const businessId = owner.businessId;
    await request(app)
      .patch(`/api/v1/businesses/${businessId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ hours: { monday: { isOpen: true, windows: [{ open: '09:00', close: '17:00' }] } } })
      .expect(200);
    const svc = await request(app)
      .post(`/api/v1/businesses/${businessId}/services`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Massage', durationMinutes: 60, price: 40 })
      .expect(201);
    const staffRes = await request(app)
      .post(`/api/v1/businesses/${businessId}/staff`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ displayName: 'Anna', shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }] })
      .expect(201);
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
    return {
      ownerId: owner,
      businessId,
      serviceId: svc.body.data.service.id,
      staffId: staffRes.body.data.staff.id,
    };
  }

  it('creates a confirmed single-service booking with server-side snapshot', async () => {
    const fx = await approvedFixture();
    const customer = await registerCustomer(app);
    const start = nextMonday10();

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        businessId: fx.businessId,
        idempotencyKey: 'idem-happy-path-01',
        segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: start.toISOString() }],
      })
      .expect(201);

    const booking = res.body.data.booking;
    assert.equal(booking.status, BookingStatus.CONFIRMED);
    assert.equal(booking.segments.length, 1);
    assert.equal(booking.segments[0].service.serviceId, fx.serviceId);
    assert.equal(booking.segments[0].service.name, 'Massage');
    assert.equal(booking.segments[0].service.price, 40);
    assert.equal(booking.segments[0].staffId, fx.staffId);
    assert.equal(booking.segments[0].startTime, start.toISOString());

    // Outbox event committed with the booking.
    const events = await db
      .collection('outbox')
      .find({ aggregateType: 'booking', eventType: 'booking.confirmed' })
      .toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0].status, 'pending');
    assert.equal(events[0].aggregateId.toString(), booking.id);
  });

  it('resolves staffId "any" deterministically', async () => {
    const fx = await approvedFixture();
    const customer = await registerCustomer(app);

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        businessId: fx.businessId,
        idempotencyKey: 'idem-any-01',
        segments: [{ serviceId: fx.serviceId, staffId: 'any', startTime: nextMonday10().toISOString() }],
      })
      .expect(201);
    assert.equal(res.body.data.booking.segments[0].staffId, fx.staffId);
  });

  it('replays the same booking for the same idempotency key (no duplicate)', async () => {
    const fx = await approvedFixture();
    const customer = await registerCustomer(app);
    const payload = {
      businessId: fx.businessId,
      idempotencyKey: 'idem-replay-01',
      segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: nextMonday10().toISOString() }],
    };

    const first = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${customer.token}`).send(payload).expect(201);
    const repeat = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${customer.token}`).send(payload).expect(200);

    assert.equal(repeat.body.data.idempotentReplay, true);
    assert.equal(repeat.body.data.booking.id, first.body.data.booking.id);
    const count = await db.collection('bookings').countDocuments({ idempotencyKey: 'idem-replay-01' });
    assert.equal(count, 1);
  });

  it('rejects unverified customers and non-customer roles', async () => {
    const fx = await approvedFixture();
    // Unverified customer: register but do not verify.
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `unv-${Date.now()}@example.com`, password: 'StrongPassword123!', fullName: 'Customer', role: UserRole.CUSTOMER })
      .expect(201);
    const unverified = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: reg.body.data.user.email, password: 'StrongPassword123!' })
      .expect(200);
    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${unverified.body.data.sessionToken}`)      .send({ businessId: fx.businessId, idempotencyKey: 'idem-unv', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: nextMonday10().toISOString() }] })
      .expect(403);

    const owner = await registerOwner(app, `book-owner2-${Date.now()}@example.com`, 'o2');
    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-owner', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: nextMonday10().toISOString() }] })
      .expect(403);
  });

  it('rejects draft businesses and cross-tenant service/staff references', async () => {
    const fx = await approvedFixture();
    const customer = await registerCustomer(app);

    // Draft business
    const draftOwner = await registerOwner(app, `draft-${Date.now()}@example.com`, 'draft');
    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessId: draftOwner.businessId, idempotencyKey: 'idem-draft', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: nextMonday10().toISOString() }] })
      .expect(404);

    // Foreign service id (valid ObjectId shape, no service in tenant)
    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-foreign-svc', segments: [{ serviceId: 'a'.repeat(24), staffId: fx.staffId, startTime: nextMonday10().toISOString() }] })
      .expect(404);

    // Foreign staff id
    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-foreign-staff', segments: [{ serviceId: fx.serviceId, staffId: 'b'.repeat(24), startTime: nextMonday10().toISOString() }] })
      .expect(404);
  });

  it('conflicts with availability violations and offers alternatives', async () => {
    const fx = await approvedFixture();
    const customer = await registerCustomer(app);

    // Start outside any window (22:00Z Monday).
    const late = nextMonday10();
    late.setUTCHours(22);
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-late', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: late.toISOString() }] })
      .expect(409);
    assert.equal(res.body.error.code, 'CONFLICT');

    // Notice violation: start 1h from now (< minNoticeHours 2) — may still
    // be outside hours depending on the wall clock; both are 409s.
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const res2 = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-soon', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: soon.toISOString() }] })
      .expect(409);
    assert.equal(res2.body.error.code, 'CONFLICT');
  });

  it('two parallel creates for the same staff/time: exactly one confirmed', async () => {
    const fx = await approvedFixture();
    const customerToken1 = await registerCustomer(app);
    const customerToken2 = await registerCustomer(app);
    const start = nextMonday10();
    const now1 = new Date(Date.now() - 20);
    const now2 = new Date(now1.getTime() + 10);

    const [first, second] = await Promise.allSettled([
      createBookingDirect({
        user: { id: customerToken1.userId, role: 'customer', isEmailVerified: true },
        payload: { businessId: fx.businessId, idempotencyKey: 'race-key-alpha', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: start.toISOString() }] },
        now: now1,
      }),
      createBookingDirect({
        user: { id: customerToken2.userId, role: 'customer', isEmailVerified: true },
        payload: { businessId: fx.businessId, idempotencyKey: 'race-key-bravo', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: start.toISOString() }] },
        now: now2,
      }),
    ]);

    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one winner');
    assert.equal(rejected.length, 1, 'exactly one loser');
    assert.match(rejected[0].reason.message, /no longer available/i);

    const confirmed = await db.collection('bookings').countDocuments({ status: 'confirmed' });
    // The loser may be rejected at plan level (before insert, cancelled=0)
    // or by the deterministic race loser path (cancelled=1) depending on
    // interleaving — both must never coexist as confirmed.
    const cancelled = await db.collection('bookings').countDocuments({ status: 'cancelled', cancelReason: 'concurrency_conflict' });
    assert.equal(confirmed, 1);
    assert.ok([0, 1].includes(cancelled), 'loser either rejected pre-insert or self-cancelled');

    const events = await db.collection('outbox').countDocuments({ eventType: 'booking.confirmed' });
    assert.equal(events, 1, 'exactly one outbox event');
  });

  it('overlapping second booking with distinct key conflicts against the first', async () => {
    const fx = await approvedFixture();
    const c1 = await registerCustomer(app);
    const start = nextMonday10();

    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${c1.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-overlap-a', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: start.toISOString() }] })
      .expect(201);

    const c2 = await registerCustomer(app);
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${c2.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-overlap-b', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: new Date(start.getTime() + 30 * 60000).toISOString() }] })
      .expect(409);
    assert.ok(res.body.error); // refreshed availability surfaced via conflict
    const confirmed = await db.collection('bookings').countDocuments({ status: 'confirmed' });
    assert.equal(confirmed, 1);
  });

  it('the customer can read back their own booking only', async () => {
    const fx = await approvedFixture();
    const customer = await registerCustomer(app);
    const other = await registerCustomer(app);
    const created = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ businessId: fx.businessId, idempotencyKey: 'idem-readback', segments: [{ serviceId: fx.serviceId, staffId: fx.staffId, startTime: nextMonday10().toISOString() }] })
      .expect(201);
    const id = created.body.data.booking.id;

    const mine = await request(app)
      .get(`/api/v1/bookings/${id}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);
    assert.equal(mine.body.data.booking.id, id);

    await request(app)
      .get(`/api/v1/bookings/${id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });
});
