import { ObjectId } from 'mongodb';
import { getDb } from '../../db/mongo.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { BusinessStatus } from '@slotify/shared';
import { computeServiceSlots, mergeAnyStaffSlots, OCCUPYING_BOOKING_STATUSES } from './slot-engine.js';
import { wallTimeToInstant, nextCalendarDate, businessDatesBetween } from './schedule-expansion.js';
import { toExceptionResponse } from '../exception-projection.js';

const MAX_QUERY_RANGE_DAYS = 14;
/** Margin subtracted from the range start when scanning booking segments so
 * pre-range buffered spans still collide with pre-range bookings. */
const BOOKING_SCAN_MARGIN_MS = 6 * 3_600_000;

/**
 * Default requested range: the current business-local date (single day).
 */
function defaultRange(timeZone, now) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now); // YYYY-MM-DD
  return { fromDate: today, toDate: today };
}

/**
 * Validate/normalize the plain range query produced by Zod.
 */
function normalizeRange({ fromDate, toDate }, timeZone) {
  let start = fromDate ?? null;
  let end = toDate ?? null;
  if (start && end && end < start) {
    throw new ValidationError('toDate must be on or after fromDate');
  }
  if (start && end && businessDatesBetween(timeZone, start, end).length > MAX_QUERY_RANGE_DAYS) {
    throw new ValidationError(`Date range cannot exceed ${MAX_QUERY_RANGE_DAYS} days`);
  }
  return { start, end };
}

/**
 * Compute bookable slots for a service over a date range, wiring all
 * persisted inputs (hours, staff, exceptions, active booking segments)
 * into the pure slot engine.
 *
 * @param {object} params
 * @param {object} params.business stored business document
 * @param {string} params.serviceId
 * @param {{ fromDate?: string, toDate?: string }} params.query
 * @param {{ staffId?: string }} [params.ownerOptions] internal owner view only
 * @param {Date} [params.now]
 * @returns {Promise<{ timeZone, serviceId, slotIntervalMinutes, range, staff: Array<{staffId, slots}>, anyStaffSlots: string[] }>}
 */
export async function computeServiceAvailability({
  business,
  serviceId: rawServiceId,
  query,
  ownerOptions = {},
  now = new Date(),
}) {
  const db = getDb();
  const timeZone = business.timeZone;
  const serviceId = new ObjectId(rawServiceId);

  const service = await db.collection('services').findOne({
    _id: serviceId,
    businessId: new ObjectId(business._id.toString()),
  });
  if (!service) {
    throw new NotFoundError('Service not found for this business');
  }

  const { start, end } = normalizeRange(query, timeZone);
  const defaulted =
    start
      ? { fromDate: start, toDate: end ?? start }
      : defaultRange(timeZone, now);

  const staff = await db
    .collection('staff')
    .find({ businessId: new ObjectId(business._id.toString()) })
    .toArray();

  const exceptions = await db
    .collection('availability_exceptions')
    .find({ businessId: new ObjectId(business._id.toString()) })
    .toArray();

  // Active booking segments near the requested window.
  const rangeStart = wallTimeToInstant(defaulted.fromDate, '00:00', timeZone).getTime();
  const rangeEnd = wallTimeToInstant(nextCalendarDate(defaulted.toDate, timeZone), '00:00', timeZone).getTime();
  const bookingDocs = await db
    .collection('bookings')
    .find({
      businessId: new ObjectId(business._id.toString()),
      status: { $in: OCCUPYING_BOOKING_STATUSES },
    })
    .toArray();
  const bookedSegments = [];
  for (const booking of bookingDocs) {
    for (const segment of booking.segments ?? []) {
      const segStart = new Date(segment.startTime).getTime();
      const segEnd = new Date(segment.endTime).getTime();
      // Keep segments overlapping [rangeStart - margin, rangeEnd)
      if (segEnd > rangeStart - BOOKING_SCAN_MARGIN_MS && segStart < rangeEnd) {
        bookedSegments.push({
          staffId: segment.staffId,
          startTime: segment.startTime,
          endTime: segment.endTime,
        });
      }
    }
  }

  const engineResult = computeServiceSlots({
    business,
    service: { ...service, requiredQualifications: service.requiredQualifications ?? [] },
    staff: ownerOptions.staffId
      ? staff.filter((s) => String(s._id) === String(ownerOptions.staffId))
      : staff,
    exceptions: exceptions.map(toExceptionResponse),
    bookedSegments,
    fromDate: defaulted.fromDate,
    toDate: defaulted.toDate,
    now,
  });

  // Public-view safety: exceptions docs may carry internal fields; the
  // engine output contains only instants and staff IDs.
  const staffView = engineResult.staff.map((s) => ({ staffId: s.staffId, slots: s.slots }));

  return {
    timeZone: engineResult.timeZone,
    serviceId: rawServiceId,
    slotIntervalMinutes: engineResult.slotIntervalMinutes,
    range: engineResult.range,
    staff: staffView,
    anyStaffSlots: mergeAnyStaffSlots(engineResult),
  };
}

/**
 * Load the business document for a public slug, enforcing the same approval
 * + completeness gate as the public profile (404 otherwise — no existence
 * leak for draft/pending/rejected businesses).
 * @param {string} slug
 * @returns {Promise<object>}
 */
export async function getApprovedBusinessBySlugForSlots(slug) {
  const db = getDb();
  const business = await db
    .collection('businesses')
    .findOne({ slug: String(slug).toLowerCase() });
  if (!business || business.status !== BusinessStatus.APPROVED) {
    throw new NotFoundError('Business not found');
  }
  const activeServiceCount = await db
    .collection('services')
    .countDocuments({ businessId: business._id, active: true });
  if (activeServiceCount === 0) {
    throw new NotFoundError('Business not found');
  }
  return business;
}
