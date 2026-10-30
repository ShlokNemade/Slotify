import { ObjectId } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import { BookingStatus } from '@slotify/shared';
import { createAvailabilityExceptionSchema } from '@slotify/shared';
import { toExceptionResponse } from './exception-projection.js';
import {
  wallTimeToInstant,
  nextCalendarDate,
  windowsToUtcIntervals,
} from './availability/schedule-expansion.js';
import { subtractIntervals, intervalsOverlap } from './availability/intervals.js';

const COLLECTION = 'availability_exceptions';
const BOOKINGS_COLLECTION = 'bookings';

/**
 * Compute the UTC instants marking the start and end of a business-local
 * calendar date.
 * @param {string} dateISO
 * @param {string} timeZone
 * @returns {{ dayStart: Date, dayEnd: Date }} half-open [dayStart, dayEnd)
 */
function localDayBounds(dateISO, timeZone) {
  const dayStart = wallTimeToInstant(dateISO, '00:00', timeZone);
  const dayEnd = wallTimeToInstant(nextCalendarDate(dateISO, timeZone), '00:00', timeZone);
  return { dayStart, dayEnd };
}

/**
 * Build the "blocked time" intervals implied by an exception, i.e. the times
 * that are no longer available to the exception's scope.
 *
 * Semantics:
 * - date-scoped closure (`isOpen: false`): the whole local day is blocked
 * - date-scoped override (`isOpen`/`windows`): the local day minus the
 *   windows is blocked (times outside the new availability)
 * - instant-scoped: exactly `[startDateTime, endDateTime)`
 *
 * @param {object} exception stored exception document
 * @param {string} timeZone business IANA zone
 * @returns {Array<{start: Date, end: Date}>}
 */
export function blockedIntervalsForException(exception, timeZone) {
  if (exception.startDateTime && exception.endDateTime) {
    return [{ start: new Date(exception.startDateTime), end: new Date(exception.endDateTime) }];
  }

  if (!exception.date) return [];
  const { dayStart, dayEnd } = localDayBounds(exception.date, timeZone);

  // Open override: block everything outside the new windows.
  if (exception.isOpen === true && Array.isArray(exception.windows)) {
    return subtractIntervals(
      [{ start: dayStart, end: dayEnd }],
      windowsToUtcIntervals(exception.date, exception.windows, timeZone)
    );
  }

  // Closure (isOpen false, or date with neither signal — schema enforced).
  return [{ start: dayStart, end: dayEnd }];
}

/**
 * Overlap predicate for a booking segment against one blocked interval.
 * @param {object} segment booking segment ({staffId, service, startTime, endTime})
 * @param {{start: Date, end: Date}} block
 * @param {ObjectId|null} staffId
 * @param {ObjectId|null} serviceId
 * @returns {boolean}
 */
function segmentBlocked(segment, block, staffId, serviceId) {
  const segStart = new Date(segment.startTime);
  const segEnd = new Date(segment.endTime);
  if (!intervalsOverlap({ start: segStart, end: segEnd }, block)) return false;
  if (staffId && (!segment.staffId || new ObjectId(segment.staffId).toString() !== staffId.toString())) {
    return false;
  }
  if (
    serviceId &&
    (!segment.service?.serviceId ||
      new ObjectId(segment.service.serviceId).toString() !== serviceId.toString())
  ) {
    return false;
  }
  return true;
}

/**
 * Scan ACTIVE bookings (pending + confirmed) that conflict with the given
 * schedule exception. Read-only: bookings are never modified — per
 * invariant, adding a schedule block never silently alters bookings; the
 * owner is warned instead by returning this list.
 *
 * Booking documents are expected in the shape defined by the shared
 * booking schema: `segments: [{ staffId, service: { serviceId, ... },
 * startTime, endTime }]` with instants stored as `Date`. Synthetic
 * documents in tests follow this shape; Phase 04 booking writes must match.
 *
 * @param {ObjectId} businessId
 * @param {object} exception stored exception document
 * @param {string} timeZone business IANA zone
 * @returns {Promise<Array<{bookingId, status, segments: Array}>>}
 */
export async function findBookingConflicts(businessId, exception, timeZone) {
  const db = getDb();
  const blocks = blockedIntervalsForException(exception, timeZone);
  if (blocks.length === 0) return [];

  const staffId = exception.staffId ? new ObjectId(exception.staffId) : null;
  const serviceId = exception.serviceId ? new ObjectId(exception.serviceId) : null;

  const candidates = await db
    .collection(BOOKINGS_COLLECTION)
    .find({
      businessId: new ObjectId(businessId),
      status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
    })
    .toArray();

  const conflicts = [];
  for (const booking of candidates) {
    const hitSegments = (booking.segments ?? []).filter((segment) =>
      blocks.some((block) => segmentBlocked(segment, block, staffId, serviceId))
    );
    if (hitSegments.length > 0) {
      conflicts.push({
        bookingId: booking._id.toString(),
        status: booking.status,
        segments: hitSegments.map((s) => ({
          staffId: s.staffId ? s.staffId.toString() : null,
          serviceId: s.service?.serviceId ? s.service.serviceId.toString() : null,
          startTime: new Date(s.startTime).toISOString(),
          endTime: new Date(s.endTime).toISOString(),
        })),
      });
    }
  }
  return conflicts;
}

/**
 * Ensure the scope referential integrity for an exception payload:
 * staffId/serviceId must belong to this business (cross-tenant references
 * are rejected server-side).
 * @param {string} businessId
 * @param {{staffId?: string, serviceId?: string}} data
 */
async function validateScopeReferences(businessId, data) {
  const db = getDb();
  if (data.staffId) {
    const staff = await db.collection('staff').findOne({
      _id: new ObjectId(data.staffId),
      businessId: new ObjectId(businessId),
    });
    if (!staff) {
      throw new NotFoundError('Staff member not found in this business');
    }
  }
  if (data.serviceId) {
    const service = await db.collection('services').findOne({
      _id: new ObjectId(data.serviceId),
      businessId: new ObjectId(businessId),
    });
    if (!service) {
      throw new ValidationError('Service not found in this business');
    }
  }
}

/**
 * Get one exception of a business or throw.
 * @param {string} businessId
 * @param {string} exceptionId
 * @returns {Promise<Record<string, unknown>>}
 */
async function getExceptionDoc(businessId, exceptionId) {
  const db = getDb();
  let id;
  try {
    id = new ObjectId(exceptionId);
  } catch {
    throw new NotFoundError('Availability exception not found');
  }
  const doc = await db.collection(COLLECTION).findOne({
    _id: id,
    businessId: new ObjectId(businessId),
  });
  if (!doc) throw new NotFoundError('Availability exception not found');
  return doc;
}

/**
 * Create an availability exception and report conflicting active bookings.
 * @param {string} businessId
 * @param {{ timeZone: string }} business business document (for its time zone)
 * @param {Record<string, unknown>} data Zod-validated payload
 * @returns {Promise<{ exception: Record<string, unknown>, conflicts: Array }>}
 */
export async function createException(businessId, business, data) {
  await validateScopeReferences(businessId, data);
  const db = getDb();
  const now = new Date();

  const doc = {
    // Scope ids are stored as ObjectIds so tenant lookups and filters match
    // the way other server code reads them back.
    ...data,
    ...(data.staffId ? { staffId: new ObjectId(data.staffId) } : {}),
    ...(data.serviceId ? { serviceId: new ObjectId(data.serviceId) } : {}),
    businessId: new ObjectId(businessId),
    createdAt: now,
    updatedAt: now,
  };
  const insertResult = await db.collection(COLLECTION).insertOne(doc);
  const stored = { ...doc, _id: insertResult.insertedId };
  const conflicts = await findBookingConflicts(new ObjectId(businessId), stored, business.timeZone);
  return { exception: toExceptionResponse(stored), conflicts };
}

/**
 * List availability exceptions of the business, optionally filtered.
 * @param {string} businessId
 * @param {{ timeZone: string }} business
 * @param {{ fromDate?: string, toDate?: string, staffId?: string }} [filters]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listExceptions(businessId, _business, filters = {}) {
  const db = getDb();
  const query = { businessId: new ObjectId(businessId) };
  if (filters.staffId) {
    query.staffId = new ObjectId(filters.staffId);
  }

  const docs = await db
    .collection(COLLECTION)
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();

  let result = docs.map(toExceptionResponse);

  if (filters.fromDate || filters.toDate) {
    const rangeStart = filters.fromDate ? wallTimeToInstant(filters.fromDate, '00:00', _business.timeZone) : null;
    const rangeEnd = filters.toDate
      ? wallTimeToInstant(nextCalendarDate(filters.toDate, _business.timeZone), '00:00', _business.timeZone)
      : null;
    result = result.filter((e) => {
      const start = e.startDateTime
        ? new Date(e.startDateTime)
        : e.date
          ? wallTimeToInstant(e.date, '00:00', _business.timeZone)
          : null;
      if (!start) return true;
      if (rangeStart && start < rangeStart) return false;
      if (rangeEnd && start >= rangeEnd) return false;
      return true;
    });
  }

  return result;
}

/**
 * Update mutable fields of an exception (scope/date fields immutable).
 * The merged document is re-validated with the creation schema so all
 * cross-field rules stay single-sourced; conflicts are re-scanned.
 * @param {string} businessId
 * @param {{ timeZone: string }} business
 * @param {string} exceptionId
 * @param {Record<string, unknown>} patch Zod-validated partial update
 * @returns {Promise<{ exception: Record<string, unknown>, conflicts: Array }>}
 */
export async function updateException(businessId, business, exceptionId, patch) {
  const doc = await getExceptionDoc(businessId, exceptionId);

  const mutable = ['isOpen', 'windows', 'startDateTime', 'endDateTime', 'reason'];
  const merged = { ...doc };
  for (const key of mutable) {
    if (patch[key] !== undefined) {
      merged[key] = patch[key];
    }
  }

  // Re-validate the FULL merged record against the creation rules.
  const validated = createAvailabilityExceptionSchema.parse({
    date: merged.date ?? undefined,
    isOpen: merged.isOpen ?? undefined,
    windows: merged.windows ?? undefined,
    staffId: merged.staffId ? merged.staffId.toString() : undefined,
    serviceId: merged.serviceId ? merged.serviceId.toString() : undefined,
    startDateTime: merged.startDateTime ? new Date(merged.startDateTime).toISOString() : undefined,
    endDateTime: merged.endDateTime ? new Date(merged.endDateTime).toISOString() : undefined,
    reason: merged.reason,
  });

  const db = getDb();
  // Temporal form and scope are immutable, so $set on the mutable fields is
  // sufficient; undefined instants simply stay absent.
  const cleanSet = {
    isOpen: merged.isOpen,
    windows: merged.windows ?? [],
    startDateTime: merged.startDateTime ? new Date(merged.startDateTime).toISOString() : null,
    endDateTime: merged.endDateTime ? new Date(merged.endDateTime).toISOString() : null,
    reason: validated.reason,
  };

  const result = await db
    .collection(COLLECTION)
    .findOneAndUpdate(
      { _id: new ObjectId(exceptionId), businessId: new ObjectId(businessId) },
      { $set: { ...cleanSet, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

  if (!result) {
    throw new NotFoundError('Availability exception not found');
  }

  const conflicts = await findBookingConflicts(new ObjectId(businessId), result, business.timeZone);
  return { exception: toExceptionResponse(result), conflicts };
}

/**
 * Delete an availability exception (config record, not booking history).
 * @param {string} businessId
 * @param {string} exceptionId
 * @returns {Promise<{ exception: Record<string, unknown> }>}
 */
export async function deleteException(businessId, exceptionId) {
  const doc = await getExceptionDoc(businessId, exceptionId);
  const db = getDb();
  await db.collection(COLLECTION).deleteOne({ _id: doc._id, businessId: new ObjectId(businessId) });
  return { exception: toExceptionResponse(doc) };
}
