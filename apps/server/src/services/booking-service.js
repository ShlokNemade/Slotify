import { ObjectId } from 'mongodb';
import { getDb, getClient } from '../db/mongo.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/index.js';
import { BookingStatus, BusinessStatus, OutboxEventType } from '@slotify/shared';
import {
  expandBusinessOpenIntervals,
  expandStaffWorkIntervals,
} from './availability/schedule-expansion.js';
import { intersectIntervalLists, subtractIntervals } from './availability/intervals.js';
import { serviceBusySpan, computeServiceSlots, mergeAnyStaffSlots, OCCUPYING_BOOKING_STATUSES } from './availability/slot-engine.js';
import { toExceptionResponse } from './exception-projection.js';

const BOOKINGS_COLLECTION = 'bookings';
const OUTBOX_COLLECTION = 'outbox';
/** Upper bound on the alternatives list returned with a conflict. */
const MAX_ALTERNATIVES = 12;

/**
 * Authoritative booking write path.
 *
 * ## Concurrency model (documented honestly — must be preserved)
 * There is no single MongoDB index that can enforce arbitrary interval
 * non-overlap (ADR-003 trade-off). The write path therefore uses a
 * **deterministic winner + self-healing loser** scheme on the single-node
 * replica set (`rs0`, primary linearizable writes):
 *
 * 1. The request is fully validated against persisted state (business,
 *    service, staff, availability plan, notice/horizon) BEFORE insert.
 * 2. The booking is inserted with status `confirmed` and an idempotency
 *    key (unique per business). A duplicate key either replays the same
 *    customer'sbooking or rejects another tenant's customer with 409.
 * 3. In a transaction, the writer reads all active overlapping bookings.
 *    If another booking outRANKS this one (earlier createdAt, then lower
 *    _id), this request is the LOSER: it self-cancels inside the
 *    transaction (with a recorded reason) and the API responds 409.
 *    Otherwise the transaction writes the outbox
 *    `booking.confirmed` event atomically with the (winning) read.
 * 4. A fresh post-commit read re-checks for a booking that committed
 *    between the transaction snapshot and this writer's commit. Because
 *    priorities derive from createdAt/_id comparison of the *same*
 *    documents, both contenders agree on the winner: exactly one booking
 *    survives as `confirmed`. The post-commit check exists because a
 *    transaction snapshot may not include commits that happened after
 *    its first read; the loser's own post-commit check always sees every
 *    earlier-committed contender.
 *
 * Consequences (accepted, documented):
 * - Two racing requests produce exactly ONE confirmed booking; the loser
 *   gets 409 with refreshment data; clients only observe final state.
 * - A loser row exists briefly as `confirmed` before its own check
 *   self-cancels; additional readers during that window could observe it.
 *   APIs route through this same function before responding.
 * - The losing outbox event (if any) is neutralized in delivery by the
 *   worker-side rule from docs/AGENTS.md: workers must re-validate booking
 *   state before sending.
 */

/**
 * Allowlisted owner/customer-safe booking projection.
 * @param {object} doc stored booking document
 * @returns {object}
 */
export function toBookingResponse(doc) {
  return {
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    customerId: doc.customerId.toString(),
    status: doc.status,
    segments: (doc.segments ?? []).map((s) => ({
      service: {
        serviceId: s.service.serviceId.toString(),
        name: s.service.name,
        durationMinutes: s.service.durationMinutes,
        bufferMinutes: s.service.bufferMinutes,
        bufferPlacement: s.service.bufferPlacement,
        price: s.service.price ?? null,
      },
      staffId: s.staffId ? s.staffId.toString() : null,
      // startTime/endTime are the customer-visible service window;
      // busyStart/busyEnd additionally carry the buffered blocked span.
      startTime: new Date(s.serviceStart ?? s.startTime).toISOString(),
      endTime: new Date(s.serviceEnd ?? s.endTime).toISOString(),
    })),
    startTime: doc.startTime ?? null,
    endTime: doc.endTime ?? null,
    cancelReason: doc.cancelReason ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function priorityOf(doc) {
  const created = new Date(doc.createdAt).getTime();
  return [created, doc._id.toString()];
}
function outranks(a, b) {
  const pa = priorityOf(a);
  const pb = priorityOf(b);
  if (pa[0] !== pb[0]) return pa[0] < pb[0];
  return pa[1] < pb[1];
}

// Interval [aStart, aEnd) stored on segment: busyStart/busyEnd preferred
// because they include placement buffers; fall back to startTime/endTime.
function spanOfSegment(segment) {
  const start = segment.busyStart ?? segment.startTime;
  const end = segment.busyEnd ?? segment.endTime;
  return { start: new Date(start), end: new Date(end) };
}

/**
 * Load ACTIVE occupancy of the business near the wanted window as a flat
 * list of segments (staffId + instants), excluding the given booking ids.
 */
async function loadActiveSegments(businessId, excludeIds = [], session = undefined) {
  const db = getDb();
  const docs = await db
    .collection(BOOKINGS_COLLECTION)
    .find(
      {
        businessId: new ObjectId(businessId),
        status: { $in: OCCUPYING_BOOKING_STATUSES },
        ...(excludeIds.length > 0 ? { _id: { $nin: excludeIds } } : {}),
      },
      { session }
    )
    .toArray();
  const result = [];
  for (const doc of docs) {
    for (const segment of doc.segments ?? []) {
      result.push({
        staffId: segment.staffId,
        startTime: segment.busyStart ?? segment.startTime,
        endTime: segment.busyEnd ?? segment.endTime,
      });
    }
  }
  return result;
}

/**
 * Simplified overlap test for the authoritative race check: does any
 * segment of `other` overlap any busy span of `mine` for the same staff?
 */
function bookingsOverlap(mine, other) {
  for (const a of mine) {
    for (const b of other) {
      if (!a.staffId || !b.staffId) {
        // Leaking-missing-staff guard: without a staff identity we treat
        // ANY overlap of instants as a conflict (conservative).
        const aSpan = { start: new Date(a.startTime), end: new Date(a.endTime) };
        const bSpan = { start: new Date(b.startTime), end: new Date(b.endTime) };
        if (aSpan.start < bSpan.end && bSpan.start < aSpan.end) return true;
        continue;
      }
      const sameStaff =
        new ObjectId(a.staffId).toString() === new ObjectId(b.staffId).toString();
      if (!sameStaff) continue;
      const aSpan = { start: new Date(a.startTime), end: new Date(a.endTime) };
      const bSpan = { start: new Date(b.startTime), end: new Date(b.endTime) };
      if (aSpan.start < bSpan.end && bSpan.start < aSpan.end) return true;
    }
  }
  return false;
}

/**
 * Cluster booking docs into flat spans lists keyed for overlap checks.
 */
function flatSpansOf(doc) {
  return (doc.segments ?? []).map((segment) => ({
    staffId: segment.staffId,
    startTime: segment.busyStart ?? segment.startTime,
    endTime: segment.busyEnd ?? segment.endTime,
  }));
}

/**
 * Create a booking: full validation, deterministic-winner concurrency
 * control, atomic outbox event.
 *
 * @param {object} params
 * @param {{ id: string, role: string, isEmailVerified: boolean }} params.user
 * @param {{ businessId: string, idempotencyKey: string, segments: Array<{serviceId: string, staffId: string|'any', startTime: string}> }} params.payload
 * @param {Date} [params.now]
 * @returns {Promise<{ booking: object, idempotentReplay: boolean }>}
 */
export async function createBooking({ user, payload, now = new Date() }) {
  if (!user) throw new ForbiddenError('Authentication required');
  if (user.role !== 'customer') {
    throw new ForbiddenError('Only customer accounts can create bookings');
  }

  const db = getDb();
  const businessId = new ObjectId(payload.businessId);

  // Idempotency fast path: retries by the same customer replay the stored
  // booking regardless of its current lifecycle stage. Must run BEFORE
  // availability planning — a replay re-validating against its own stored
  // occupancy would otherwise conflict with itself.
  const priorDoc = await db
    .collection(BOOKINGS_COLLECTION)
    .findOne({ businessId, idempotencyKey: payload.idempotencyKey });
  if (priorDoc) {
    if (priorDoc.customerId.toString() === user.id) {
      return { booking: toBookingResponse(priorDoc), idempotentReplay: true };
    }
    throw new ConflictError('Idempotency key already used by another customer');
  }

  // 1. Business must be published (approved + complete).
  const business = await db.collection('businesses').findOne({ _id: businessId });
  if (!business || business.status !== BusinessStatus.APPROVED) {
    throw new NotFoundError('Business not found');
  }
  const activeServiceCount = await db
    .collection('services')
    .countDocuments({ businessId, active: true });
  if (activeServiceCount === 0) {
    throw new NotFoundError('Business not found');
  }

  // 2. Referenced services must be active and inside the tenant.
  const uniqueServiceIds = [...new Set(payload.segments.map((s) => s.serviceId))];
  const serviceDocs = await db
    .collection('services')
    .find({ businessId, active: true, _id: { $in: uniqueServiceIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const serviceById = new Map(serviceDocs.map((s) => [s._id.toString(), s]));
  for (const serviceRef of uniqueServiceIds) {
    if (!serviceById.has(serviceRef)) {
      throw new NotFoundError('Service not available');
    }
  }

  // 3. Staff universe of the tenant.
  const staffDocs = await db
    .collection('staff')
    .find({ businessId })
    .toArray();

  // 4. Exceptions (staff- and business-scoped) as the engine consumes them.
  const exceptionDocs = await db
    .collection('availability_exceptions')
    .find({ businessId })
    .toArray();
  const exceptions = exceptionDocs.map(toExceptionResponse);

  // 5. Build the plan: resolve staff ('any' or explicit), validate spans and
  //    notice/horizon, subtract existing occupancy and intra-booking spans.
  const timeZone = business.timeZone;
  const busySpans = payload.segments.map((segment) => {
    const service = serviceById.get(segment.serviceId);
    return {
      ...segment,
      service,
      busy: serviceBusySpan(new Date(segment.startTime), service),
    };
  });

  // Notice + horizon per segment customer-visible start.
  const noticeFloor = now.getTime() + (business.minNoticeHours ?? 0) * 3_600_000;
  const horizonEnd =
    now.getTime() + (business.maxHorizonDays ?? 60) * 24 * 3_600_000;

  for (let i = 0; i < busySpans.length; i += 1) {
    const span = busySpans[i];
    const startRaw = new Date(span.startTime).getTime();
    if (startRaw < noticeFloor) {
      throw new ConflictError('Start time is inside the minimum notice window', {
        segmentIndex: i,
      });
    }
    if (startRaw >= horizonEnd) {
      throw new ConflictError('Start time is beyond the booking horizon', {
        segmentIndex: i,
      });
    }
  }

  // Local-date coverage window for the availability inputs.
  const dates = [
    ...new Set(
      busySpans.map(
        (span) =>
          new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(span.startTime))
      )
    ),
  ].sort();
  const fromDate = dates[0];
  const toDate = dates[dates.length - 1];

  const businessOpen = expandBusinessOpenIntervals({
    timeZone,
    hours: business.hours,
    exceptions: exceptions.filter((e) => !e.staffId && !e.serviceId),
    fromDate,
    toDate,
  });
  const openCache = new Map();

  function availabilityFor(staffMember) {
    const key = staffMember._id.toString();
    if (!openCache.has(key)) {
      openCache.set(
        key,
        intersectIntervalLists(
          expandStaffWorkIntervals({ staff: staffMember, timeZone, exceptions, fromDate, toDate }),
          businessOpen
        )
      );
    }
    return openCache.get(key);
  }

  /** Active occupancy of the business (pre-insert; opponent bookings join via race checks). */
  const existingOccupancy = await loadActiveSegments(businessId);
  const occupancyByStaff = new Map();
  for (const occ of existingOccupancy) {
    if (!occ.staffId) continue;
    const key = occ.staffId.toString();
    if (!occupancyByStaff.has(key)) occupancyByStaff.set(key, []);
    occupancyByStaff.get(key).push({
      start: new Date(occ.startTime),
      end: new Date(occ.endTime),
    });
  }

  /**
   * Try to fit `candidate` as the staff member for segment index `index`.
   */
  function spanFits(staffMember, busy, planSpansForStaff) {
    const key = staffMember._id.toString();
    let remaining = subtractIntervals(availabilityFor(staffMember), occupancyByStaff.get(key) ?? []);
    remaining = subtractIntervals(remaining, planSpansForStaff);
    return remaining.some(
      (interval) => interval.start.getTime() <= busy.start.getTime() && interval.end.getTime() >= busy.end.getTime()
    );
  }

  function sortCandidates(candidates) {
    return [...candidates].sort(
      (a, b) => a.displayName.localeCompare(b.displayName) || a._id.toString().localeCompare(b._id.toString())
    );
  }

  function isCandidateStaff(member, service) {
    if (!member || member.active !== true) return false;
    const eligible = new Set((service.eligibleStaffIds ?? []).map(String));
    if (eligible.size > 0 && !eligible.has(member._id.toString())) return false;
    const required = new Set(service.requiredQualifications ?? []);
    return [...required].every((q) => (member.qualifications ?? []).includes(q));
  }

  function candidateStaffFor(segment, service) {
    if (segment.staffId !== 'any') {
      const explicit = staffDocs.find((s) => s._id.toString() === segment.staffId);
      if (!explicit) return null;
      return isCandidateStaff(explicit, service) ? [explicit] : [];
    }
    return sortCandidates(staffDocs.filter((member) => isCandidateStaff(member, service)));
  }

  const planSpansByStaff = new Map();
  const plan = [];
  const failures = [];
  for (let i = 0; i < busySpans.length; i += 1) {
    const item = busySpans[i];
    const candidates = candidateStaffFor(item, item.service);
    if (candidates === null) {
      throw new NotFoundError('Staff member not found in this business');
    }
    if (candidates.length === 0) {
      failures.push({ segmentIndex: i, serviceId: item.serviceId, reason: 'no eligible staff' });
      continue;
    }
    let assigned = null;
    for (const candidate of candidates) {
      const key = candidate._id.toString();
      if (!planSpansByStaff.has(key)) planSpansByStaff.set(key, []);
      if (spanFits(candidate, item.busy, planSpansByStaff.get(key))) {
        assigned = candidate;
        break;
      }
    }
    if (!assigned) {
      failures.push({ segmentIndex: i, serviceId: item.serviceId, reason: 'no staff availability at the requested time' });
      continue;
    }
    const key = assigned._id.toString();
    planSpansByStaff.get(key).push(item.busy);
    const serviceEnd = new Date(
      new Date(item.startTime).getTime() + item.service.durationMinutes * 60_000
    );
    plan.push({
      segment: {
        service: {
          serviceId: item.service._id,
          name: item.service.name,
          durationMinutes: item.service.durationMinutes,
          bufferMinutes: item.service.bufferMinutes ?? 0,
          bufferPlacement: item.service.bufferPlacement ?? 'after',
          price: item.service.price ?? null,
        },
        staffId: assigned._id,
        startTime: item.busy.start,
        endTime: item.busy.end,
        serviceStart: new Date(item.startTime),
        serviceEnd,
      },
      assigned,
    });
  }

  if (failures.length > 0) {
    // Compose "available alternates" for the first failed segment's service.
    const firstFailure = failures[0];
    const failedService = serviceById.get(firstFailure.serviceId);
    const failedSpan = busySpans[firstFailure.segmentIndex];
    const failedDate = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(failedSpan.startTime));
    let alternatives = [];
    try {
      const slotResult = computeServiceSlots({
        business,
        service: failedService,
        staff: staffDocs,
        exceptions,
        bookedSegments: existingOccupancy,
        fromDate: failedDate,
        toDate: failedDate,
        now,
      });
      alternatives = mergeAnyStaffSlots(slotResult).slice(0, MAX_ALTERNATIVES);
    } catch {
      alternatives = [];
    }
    throw new ConflictError('The selected time is no longer available', {
      failures: firstFailure,
      alternatives,
      timeZone,
    });
  }

  // 6. Assemble the document; aggregate span from busy bounds.
  const segmentDocs = plan.map((p) => p.segment);
  const allStarts = segmentDocs.map((s) => s.busyStart ?? s.startTime);
  const allEnds = segmentDocs.map((s) => s.busyEnd ?? s.endTime);
  const aggregateStart = allStarts.reduce((min, date) => Math.min(min, date.getTime()), Infinity);
  const aggregateEnd = allEnds.reduce((max, date) => Math.max(max, date.getTime()), -Infinity);

  const bookingDoc = {
    businessId,
    customerId: new ObjectId(user.id),
    idempotencyKey: payload.idempotencyKey,
    status: BookingStatus.CONFIRMED,
    segments: segmentDocs,
    startTime: new Date(aggregateStart),
    endTime: new Date(aggregateEnd),
    createdAt: now,
    updatedAt: now,
  };

  // 7. Insert (the fast-path pre-check above already filtered same-customer
  // replays; a duplicate key here can only be a same-ms race with another
  // request of the same or another customer).
  let insertedId;
  try {
    const insert = await db.collection(BOOKINGS_COLLECTION).insertOne(bookingDoc);
    insertedId = insert.insertedId;
  } catch (err) {
    if (err && err.code === 11000) {
      // Insert raced with another owner of the same idempotency key.
      const raced = await db
        .collection(BOOKINGS_COLLECTION)
        .findOne({ businessId, idempotencyKey: payload.idempotencyKey });
      if (raced && raced.customerId.toString() === user.id) {
        return { booking: toBookingResponse(raced), idempotentReplay: true };
      }
      throw new ConflictError('Idempotency key already used by another customer');
    }
    throw err;
  }

  const selfDoc = { ...bookingDoc, _id: insertedId };
  let lostRace = false;

  const session = getClient().startSession();
  try {
    await session.withTransaction(async () => {
      const contenders = await db
        .collection(BOOKINGS_COLLECTION)
        .find(
          {
            businessId,
            status: { $in: OCCUPYING_BOOKING_STATUSES },
            _id: { $ne: insertedId },
          },
          { session }
        )
        .toArray();
      const overlapping = contenders.filter((other) => bookingsOverlap(selfDoc.segments.map(spanOfSegment), flatSpansOf(other)));
      if (overlapping.some((other) => outranks(other, selfDoc))) {
        // LOSER: self-cancel inside the transaction; no outbox event.
        await db
          .collection(BOOKINGS_COLLECTION)
          .updateOne(
            { _id: insertedId },
            {
              $set: {
                status: BookingStatus.CANCELLED,
                cancelReason: 'concurrency_conflict',
                updatedAt: now,
              },
            },
            { session }
          );
        lostRace = true;
        return;
      }
      // WINNER: outbox event committed atomically with the read.
      await db
        .collection(OUTBOX_COLLECTION)
        .insertOne(
          {
            aggregateType: 'booking',
            aggregateId: insertedId,
            eventType: OutboxEventType.BOOKING_CONFIRMED,
            payload: {
              bookingId: insertedId.toString(),
              businessId: payload.businessId,
              customerId: user.id,
              status: BookingStatus.CONFIRMED,
            },
            status: 'pending',
            attempts: 0,
            createdAt: now,
          },
          { session }
        );
    });
  } finally {
    await session.endSession();
  }

  if (lostRace) {
    throw new ConflictError('The selected time is no longer available');
  }

  // 8. Post-commit revalidation: transactions snapshot reads, so a booking
  // that committed between our first read and our commit would be invisible
  // inside the transaction. This fresh (linearizable, primary) read catches it.
  const postContenders = await db
    .collection(BOOKINGS_COLLECTION)
    .find({
      businessId,
      status: { $in: OCCUPYING_BOOKING_STATUSES },
      _id: { $ne: insertedId },
      // Cheap prefilter by aggregate window before the full overlap walk.
      startTime: { $lt: bookingDoc.endTime },
      endTime: { $gt: bookingDoc.startTime },
    })
    .toArray();
  const postLost = postContenders
    .filter((other) => bookingsOverlap(selfDoc.segments.map(spanOfSegment), flatSpansOf(other)))
    .some((other) => outranks(other, selfDoc));
  if (postLost) {
    await db
      .collection(BOOKINGS_COLLECTION)
      .updateOne(
        { _id: insertedId },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancelReason: 'concurrency_conflict',
            updatedAt: new Date(),
          },
        }
      );
    throw new ConflictError('The selected time is no longer available');
  }

  const finalDoc = await db.collection(BOOKINGS_COLLECTION).findOne({ _id: insertedId });
  return { booking: toBookingResponse(finalDoc), idempotentReplay: false };
}

/**
 * Fetch one booking visible to its own customer only (owner views arrive in
 * the bookings-management increment).
 * @param {{ id: string, role: string }} user
 * @param {string} bookingId
 */
export async function getBookingForCustomer(user, bookingId) {
  const db = getDb();
  let id;
  try {
    id = new ObjectId(bookingId);
  } catch {
    throw new NotFoundError('Booking not found');
  }
  const doc = await db.collection(BOOKINGS_COLLECTION).findOne({ _id: id });
  if (!doc || user.role !== 'customer' || doc.customerId.toString() !== user.id) {
    throw new NotFoundError('Booking not found');
  }
  return { booking: toBookingResponse(doc) };
}

function parseBookingId(bookingId) {
  try {
    return new ObjectId(bookingId);
  } catch {
    throw new NotFoundError('Booking not found');
  }
}

/**
 * List a customer's bookings, newest appointments first.
 */
export async function listBookingsForCustomer(user) {
  const docs = await getDb()
    .collection(BOOKINGS_COLLECTION)
    .find({ customerId: new ObjectId(user.id) })
    .sort({ startTime: 1, createdAt: -1 })
    .toArray();
  return { bookings: docs.map(toBookingResponse) };
}

/**
 * Cancel a future customer booking and publish its lifecycle event atomically.
 */
export async function cancelBooking({ user, bookingId, reason, now = new Date() }) {
  const db = getDb();
  const id = parseBookingId(bookingId);
  const session = getClient().startSession();
  let updated;

  try {
    await session.withTransaction(async () => {
      const current = await db.collection(BOOKINGS_COLLECTION).findOne(
        { _id: id },
        { session }
      );
      if (!current || current.customerId.toString() !== user.id) {
        throw new NotFoundError('Booking not found');
      }
      if (current.status !== BookingStatus.CONFIRMED) {
        throw new ConflictError('Only confirmed bookings can be cancelled');
      }
      if (new Date(current.startTime).getTime() <= now.getTime()) {
        throw new ConflictError('Bookings cannot be cancelled after they start');
      }

      const result = await db.collection(BOOKINGS_COLLECTION).findOneAndUpdate(
        { _id: id, status: BookingStatus.CONFIRMED },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancelReason: reason,
            updatedAt: now,
          },
        },
        { returnDocument: 'after', session }
      );
      if (!result) {
        throw new ConflictError('Booking status changed; please refresh and try again');
      }
      updated = result;

      await db.collection(OUTBOX_COLLECTION).insertOne(
        {
          aggregateType: 'booking',
          aggregateId: id,
          eventType: OutboxEventType.BOOKING_CANCELLED,
          payload: {
            bookingId: id.toString(),
            businessId: current.businessId.toString(),
            customerId: current.customerId.toString(),
            reason,
          },
          status: 'pending',
          attempts: 0,
          createdAt: now,
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
  return { booking: toBookingResponse(updated) };
}

/**
 * List bookings belonging to an owned business.
 */
export async function listBookingsForBusiness(businessId, query = {}) {
  const filter = { businessId: new ObjectId(businessId) };
  if (query.status) filter.status = query.status;
  const docs = await getDb()
    .collection(BOOKINGS_COLLECTION)
    .find(filter)
    .sort({ startTime: 1, createdAt: -1 })
    .toArray();
  return { bookings: docs.map(toBookingResponse) };
}

/**
 * Move a confirmed booking to an owner-controlled terminal status.
 */
export async function updateBookingStatus({ businessId, bookingId, status, now = new Date() }) {
  if (![BookingStatus.COMPLETED, BookingStatus.NO_SHOW].includes(status)) {
    throw new ConflictError('Only completed or no_show are valid owner statuses');
  }

  const id = parseBookingId(bookingId);
  const result = await getDb().collection(BOOKINGS_COLLECTION).findOneAndUpdate(
    {
      _id: id,
      businessId: new ObjectId(businessId),
      status: BookingStatus.CONFIRMED,
    },
    { $set: { status, updatedAt: now } },
    { returnDocument: 'after' }
  );
  if (!result) {
    throw new NotFoundError('Confirmed booking not found');
  }
  return { booking: toBookingResponse(result) };
}
