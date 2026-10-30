import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createApp } from '../src/app.js';
import { connectMongo, closeMongo } from '../src/db/mongo.js';
import { UserRole } from '@slotify/shared';

/**
 * Bootstrapped fixtures: owner token + business (+ service/staff) ids.
 */
let ownerToken;
let business;
let staffId;
let otherOwnerToken;

async function loginAsOwner(app, email) {
  const reg = await request(app)
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
    .send({ token: reg.body.data.devVerificationToken })
    .expect(200);
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'StrongPassword123!' })
    .expect(200);
  return login.body.data.sessionToken;
}

async function createFixtureBusiness(app, token, slug) {
  const res = await request(app)
    .post('/api/v1/businesses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: `Blocks ${slug}`,
      slug,
      category: 'spa',
      timeZone: 'UTC',
      location: { address: 'Street 1', city: 'Berlin', country: 'Germany' },
    })
    .expect(201);
  return res.body.data.business.id;
}

let bookingSeq = 0;
function bookingDoc(businessId, { staffId: segmentStaff = null, start, end, status = 'confirmed' } = {}) {
  bookingSeq += 1;
  return {
    businessId: new ObjectId(businessId),
    customerId: new ObjectId(),
    idempotencyKey: `e2e-exception-${bookingSeq}-${Date.now()}`,
    status,
    segments: [
      {
        staffId: segmentStaff ? new ObjectId(segmentStaff) : new ObjectId(),
        service: { serviceId: new ObjectId(), name: 'Massage', durationMinutes: 60 },
        startTime: start instanceof Date ? start : new Date(start),
        endTime: end instanceof Date ? end : new Date(end),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const utc = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(date.slice(0, 4) * 1, date.slice(5, 7) - 1, date.slice(8, 10) * 1, h, m));
};

describe('Availability Exceptions API Integration Tests', { concurrency: 1 }, () => {
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
    await db.collection('bookings').deleteMany({});
    await db.collection('availability_exceptions').deleteMany({});

    ownerToken = await loginAsOwner(app, 'owner-blocks@example.com');
    business = await createFixtureBusiness(app, ownerToken, 'blocks-spa');

    await request(app)
      .post(`/api/v1/businesses/${business}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Massage', durationMinutes: 60 })
      .expect(201);

    const staffRes = await request(app)
      .post(`/api/v1/businesses/${business}/staff`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        displayName: 'Anna',
        shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }],
      })
      .expect(201);
    staffId = staffRes.body.data.staff.id;

    otherOwnerToken = await loginAsOwner(app, 'owner-other@example.com');
  });

  it('creates a business-wide date closure with no conflicts', async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date: '2026-12-25', isOpen: false, reason: 'Christmas closure' })
      .expect(201);

    assert.equal(res.body.data.exception.date, '2026-12-25');
    assert.deepEqual(res.body.data.conflicts, []);

    const list = await request(app)
      .get(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    assert.equal(list.body.data.exceptions.length, 1);
    assert.equal(list.body.data.exceptions[0].reason, 'Christmas closure');
  });

  it('warns about overlapping confirmed bookings, never alters them', async () => {
    const booking = bookingDoc(business, {
      staffId,
      start: utc('2026-12-25', '10:00'),
      end: utc('2026-12-25', '11:00'),
    });
    const inserted = await db.collection('bookings').insertOne(booking);

    const res = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date: '2026-12-25', isOpen: false, reason: 'Closed for repairs' })
      .expect(201);

    assert.equal(res.body.data.conflicts.length, 1);
    assert.equal(res.body.data.conflicts[0].bookingId, inserted.insertedId.toString());
    assert.equal(res.body.data.conflicts[0].status, 'confirmed');
    assert.equal(res.body.data.conflicts[0].segments[0].startTime, utc('2026-12-25', '10:00').toISOString());

    // The booking itself is untouched (invariant 5).
    const stored = await db.collection('bookings').findOne({ _id: inserted.insertedId });
    assert.equal(stored.status, 'confirmed');
    assert.equal(stored.segments.length, 1);
  });

  it('flags only bookings outside the override windows', async () => {
    const inWindow = bookingDoc(business, {
      start: utc('2026-03-04', '10:00'),
      end: utc('2026-03-04', '11:00'),
    });
    const afterWindow = bookingDoc(business, {
      start: utc('2026-03-04', '18:00'),
      end: utc('2026-03-04', '19:00'),
    });
    await db.collection('bookings').insertMany([inWindow, afterWindow]);

    const res = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        date: '2026-03-04',
        isOpen: true,
        windows: [{ open: '09:00', close: '17:00' }],
        reason: 'Short day',
      })
      .expect(201);

    assert.equal(res.body.data.conflicts.length, 1);
    assert.equal(
      res.body.data.conflicts[0].segments[0].startTime,
      utc('2026-03-04', '18:00').toISOString()
    );
  });

  it('scopes staff closures to that staff member only', async () => {
    const staffBooking = bookingDoc(business, {
      staffId,
      start: utc('2026-01-05', '09:00'),
      end: utc('2026-01-05', '10:00'),
    });
    const otherBooking = bookingDoc(business, {
      start: utc('2026-01-05', '09:00'),
      end: utc('2026-01-05', '10:00'),
    });
    await db.collection('bookings').insertMany([staffBooking, otherBooking]);

    const res = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date: '2026-01-05', isOpen: false, staffId, reason: 'Anna sick leave' })
      .expect(201);

    assert.equal(res.body.data.conflicts.length, 1);
    assert.equal(res.body.data.conflicts[0].segments[0].staffId, staffId);
  });

  it('flags partially overlapping instant-scoped blocks; ignores cancelled bookings', async () => {
    const active = bookingDoc(business, {
      start: utc('2026-05-01', '10:00'),
      end: utc('2026-05-01', '12:00'),
    });
    const cancelled = bookingDoc(business, {
      start: utc('2026-05-01', '10:00'),
      end: utc('2026-05-01', '12:00'),
      status: 'cancelled',
    });
    await db.collection('bookings').insertMany([active, cancelled]);

    const res = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        startDateTime: utc('2026-05-01', '11:00').toISOString(),
        endDateTime: utc('2026-05-01', '13:00').toISOString(),
        reason: 'Fire alarm strip-out',
      })
      .expect(201);

    assert.equal(res.body.data.conflicts.length, 1);
    assert.equal(res.body.data.exception.startDateTime, utc('2026-05-01', '11:00').toISOString());
    assert.equal(res.body.data.exception.date, null);
  });

  it('rejects invalid payloads with 400', async () => {
    const cases = [
      { date: '2026-05-01', startDateTime: utc('2026-05-01', '10:00').toISOString(), endDateTime: utc('2026-05-01', '11:00').toISOString(), reason: 'Both forms' },
      { date: '2026-05-01', reason: 'No temporal details' },
      { date: '2026-05-01', isOpen: false, windows: [{ open: '09:00', close: '10:00' }], reason: 'Closed with windows' },
      { startDateTime: utc('2026-05-01', '11:00').toISOString(), endDateTime: utc('2026-05-01', '10:00').toISOString(), reason: 'Reversed' },
      { date: '2026-05-01', isOpen: false, staffId: new ObjectId().toString(), serviceId: new ObjectId().toString(), reason: 'Both scopes' },
      { windows: [{ open: '09:00', close: '10:00' }], reason: 'Missing date' },
    ];
    for (const [index, body] of cases.entries()) {
      const res = await request(app)
        .post(`/api/v1/businesses/${business}/exceptions`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(body);
      assert.equal(res.status, 400, `case ${index} should be rejected`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('rejects a foreign staffId (cross-tenant scope reference)', async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date: '2026-05-01', isOpen: false, staffId: new ObjectId().toString(), reason: 'Random staff id' })
      .expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('rejects cross-tenant access to exceptions of another business', async () => {
    await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({ date: '2026-05-01', isOpen: false, reason: 'Not my business' })
      .expect(403);
  });

  it('updates windows and re-scans conflicts', async () => {
    const booking = bookingDoc(business, {
      start: utc('2026-06-01', '10:00'),
      end: utc('2026-06-01', '11:00'),
    });
    const inserted = await db.collection('bookings').insertOne(booking);

    const created = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date: '2026-06-01', isOpen: false, reason: 'Full day off' })
      .expect(201);
    const id = created.body.data.exception.id;
    assert.equal(created.body.data.conflicts.length, 1);

    // Owner decides to short the day instead: 09-09 (booking outside windows).
    const patched = await request(app)
      .patch(`/api/v1/businesses/${business}/exceptions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        isOpen: true,
        windows: [{ open: '12:00', close: '17:00' }],
        reason: 'Morning maintenance',
      })
      .expect(200);
    assert.equal(patched.body.data.exception.isOpen, true);
    assert.equal(patched.body.data.conflicts.length, 1);

    // Now extend windows to cover the booking: conflict disappears.
    const widened = await request(app)
      .patch(`/api/v1/businesses/${business}/exceptions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        isOpen: true,
        windows: [
          { open: '09:00', close: '12:00' },
          { open: '12:00', close: '17:00' },
        ],
        reason: 'Morning maintenance',
      })
      .expect(200);
    assert.equal(widened.body.data.conflicts.length, 0);

    const after = await db.collection('bookings').findOne({ _id: inserted.insertedId });
    assert.equal(after.status, 'confirmed');
  });

  it('rejects an invalid PATCH (closed with windows) with 400', async () => {
    const created = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ startDateTime: utc('2026-07-01', '09:00').toISOString(), endDateTime: utc('2026-07-01', '10:00').toISOString(), reason: 'Break' })
      .expect(201);
    const id = created.body.data.exception.id;

    const res = await request(app)
      .patch(`/api/v1/businesses/${business}/exceptions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isOpen: false, windows: [{ open: '09:00', close: '10:00' }] })
      .expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('deletes an exception', async () => {
    const created = await request(app)
      .post(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ date: '2026-08-01', isOpen: false, reason: 'Training day' })
      .expect(201);
    const id = created.body.data.exception.id;

    await request(app)
      .delete(`/api/v1/businesses/${business}/exceptions/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const list = await request(app)
      .get(`/api/v1/businesses/${business}/exceptions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    assert.equal(list.body.data.exceptions.length, 0);
  });
});
