import { DateTime } from 'luxon';
import {
  expandBusinessOpenIntervals,
  expandStaffWorkIntervals,
  businessDatesBetween,
} from './schedule-expansion.js';
import { intersectIntervalLists, subtractIntervals, isValidInterval } from './intervals.js';

/**
 * Slot engine: pure computation of bookable slot starts for one service.
 *
 * Input model (all decisions server-side, none trusted from clients):
 * - `business`: document with timeZone, hours, defaultSlotIntervalMinutes,
 *   minNoticeHours, maxHorizonDays.
 * - `service`: document with durationMinutes, bufferMinutes,
 *   bufferPlacement, eligibleStaffIds, requiredQualifications.
 * - `staff`: candidate staff documents (eligibility filtered here).
 * - `exceptions`: availability exception documents (business-, staff-, or
 *   service-scoped) as persisted in `availability_exceptions`.
 * - `bookedSegments`: flat list `{ staffId, startTime, endTime }` of ACTIVE
 *   booking segments (pending + confirmed) for this business, restricted to
 *   the requested range by the caller.
 *
 * Output: per active, eligible staff member, the sorted list of slot start
 * instants (ISO 8601 UTC strings) where the service — with its configured
 * buffering — fits inside (business open ∩ staff work − bookings − service
 * blocks), honoring notice/horizon.
 *
 * Slot grid: anchored at business-local midnight, stepped by
 * `defaultSlotIntervalMinutes` (e.g. 30 → :00/:30 boundaries), so candidates
 * always sit on stable human wall-clock boundaries per day. Candidates that
 * resolve through DST gaps are deduplicated by instant.
 *
 * Buffer semantics for a single segment:
 * - `after`:   buffered span = [start, start + duration + buffer)
 * - `before`:  buffered span = [start - buffer, start + duration)
 * - `between`: acts as `after` for a single segment; the true
 *              between-segments semantics materialize when the Phase 04
 *              write path composes consecutive multi-service segments.
 * The buffered span must fit entirely within the remaining availability.
 */

/**
 * Filter the staff list down to members allowed to perform the service:
 * active, eligible via eligibleStaffIds (empty = all active staff) and
 * holding every requiredQualification.
 * @param {object} service
 * @param {Array<object>} staffList
 * @returns {Array<object>}
 */
export function selectEligibleStaff(service, staffList) {
  const eligible = new Set((service?.eligibleStaffIds ?? []).map(String));
  const required = new Set(service?.requiredQualifications ?? []);
  return (staffList ?? []).filter(
    (member) =>
      member?.active === true &&
      (eligible.size === 0 || eligible.has(String(member._id))) &&
      [...required].every((q) => (member.qualifications ?? []).includes(q))
  );
}

/**
 * Timespan the service occupies (buffered) when starting at `startTime`.
 * Exported for the booking write path so both paths share the exact same
 * span rules (before/after placement included).
 * @param {Date} startTime customer-visible start
 * @param {object} service
 * @returns {{ start: Date, end: Date }} buffered blocked span
 */
export function serviceBusySpan(startTime, service) {
  const start = startTime.getTime();
  const durationMs = (service.durationMinutes ?? 0) * 60_000;
  const bufferMs = (service.bufferMinutes ?? 0) * 60_000;
  if (service.bufferPlacement === 'before') {
    return { start: new Date(start - bufferMs), end: new Date(start + durationMs) };
  }
  return { start: startTime, end: new Date(start + durationMs + bufferMs) };
}

/**
 * @internal
 * @param {Date} startTime
 * @param {object} service
 * @returns {{ start: Date, end: Date }}
 */
function bufferedSpan(startTime, service) {
  return serviceBusySpan(startTime, service);
}

/**
 * Compute bookable slots for one service.
 * @param {object} params
 * @param {object} params.business stored business document
 * @param {object} params.service stored service document
 * @param {Array<object>} [params.staff=[]]
 * @param {Array<object>} [params.exceptions=[]]
 * @param {Array<{staffId: ObjectId|string, startTime: Date, endTime: Date}>} [params.bookedSegments=[]]
 * @param {string} params.fromDate `YYYY-MM-DD` business-local (inclusive)
 * @param {string} params.toDate `YYYY-MM-DD` business-local (inclusive)
 * @param {Date} [params.now] testing hook for the notice window and horizon
 * @returns {{ timeZone: string, slotIntervalMinutes: number, range: {fromDate: string, toDate: string}, staff: Array<{ staffId: string, slots: string[] }> }}
 */
export function computeServiceSlots({
  business,
  service,
  staff = [],
  exceptions = [],
  bookedSegments = [],
  fromDate,
  toDate,
  now = new Date(),
}) {
  const timeZone = business.timeZone;
  if (!timeZone) {
    throw new Error('business.timeZone is required');
  }
  const intervalMinutes = business.defaultSlotIntervalMinutes ?? 30;
  const noticeFloor = now.getTime() + (business.minNoticeHours ?? 0) * 3_600_000;

  const base = {
    timeZone,
    slotIntervalMinutes: intervalMinutes,
    range: { fromDate, toDate },
    staff: [],
  };

  // Clamp the requested window to the booking horizon (business-local
  // dates counted inclusively from the caller's "now").
  const nowLocal = DateTime.fromJSDate(now).setZone(timeZone);
  const horizonEndISO = nowLocal
    .plus({ days: (business.maxHorizonDays ?? 60) - 1 })
    .toFormat('yyyy-MM-dd');
  const horizonEndInstant = DateTime.fromISO(horizonEndISO, { zone: timeZone })
    .plus({ days: 1 })
    .toJSDate()
    .getTime();
  const dates = businessDatesBetween(timeZone, fromDate, toDate).filter((d) => {
    const dayStart = DateTime.fromISO(d, { zone: timeZone }).toJSDate().getTime();
    return dayStart < horizonEndInstant;
  });
  if (dates.length === 0) return base;

  // Business open hours with business-wide exceptions applied; service-
  // and staff-scoped exceptions are consumed below.
  const openIntervals = expandBusinessOpenIntervals({
    timeZone,
    hours: business.hours,
    exceptions: (exceptions ?? []).filter((e) => !e.staffId && !e.serviceId),
    fromDate: dates[0],
    toDate: dates[dates.length - 1],
  });

  // Service-scoped instant blocks remove availability for this service only.
  const serviceBlocks = (exceptions ?? [])
    .filter(
      (e) =>
        e.serviceId &&
        String(e.serviceId) === String(service._id) &&
        e.startDateTime &&
        e.endDateTime
    )
    .map((e) => ({ start: new Date(e.startDateTime), end: new Date(e.endDateTime) }))
    .filter(isValidInterval);

  const eligible = selectEligibleStaff(service, staff);

  const staffResults = eligible.map((member) => {
    // 1. staff work (shifts − breaks − leave − own exceptions) ∩ business open
    let remaining = intersectIntervalLists(
      expandStaffWorkIntervals({
        staff: member,
        timeZone,
        exceptions,
        fromDate: dates[0],
        toDate: dates[dates.length - 1],
      }),
      openIntervals
    );

    // 2. subtract ACTIVE bookings assigned to this staff member
    const ownBookings = bookedSegments
      .filter((s) => String(s.staffId) === String(member._id))
      .map((s) => ({ start: new Date(s.startTime), end: new Date(s.endTime) }))
      .filter(isValidInterval);
    remaining = subtractIntervals(remaining, ownBookings);

    // 3. subtract service-scoped instant blocks
    remaining = subtractIntervals(remaining, serviceBlocks);

    // 4. walk the business-local slot grid per day and keep starts whose
    //    buffered span fits entirely inside the remaining availability.
    const slots = [];
    for (const dateISO of dates) {
      const dayStart = DateTime.fromISO(dateISO, { zone: timeZone });
      if (!dayStart.isValid) continue;
      for (let offsetMinutes = 0; offsetMinutes < 24 * 60; offsetMinutes += intervalMinutes) {
        const candidateDt = dayStart.plus({ minutes: offsetMinutes });
        if (!candidateDt.isValid) continue;
        const candidate = candidateDt.toJSDate();
        const t = candidate.getTime();
        if (t < noticeFloor) continue;
        const span = bufferedSpan(candidate, service);
        const fits = remaining.some(
          (i) => i.start.getTime() <= span.start.getTime() && i.end.getTime() >= span.end.getTime()
        );
        if (fits) {
          slots.push(candidate.toISOString());
        }
      }
    }
    // Deduplicate by instant (DST gap roll-forward can alias two offsets)
    // and keep them sorted.
    return { staffId: String(member._id), slots: [...new Set(slots)].sort() };
  });

  return { ...base, staff: staffResults };
}

/**
 * Merge per-staff slot lists into the "Any available" view: a slot is
 * offered if ANY staff member offers it (the customer's chosen staff can be
 * resolved later; the Phase 04 write path revalidates).
 * @param {{ staff: Array<{ staffId: string, slots: string[] }> }} slotResult
 * @returns {string[]} sorted distinct ISO instants
 */
export function mergeAnyStaffSlots(slotResult) {
  return [...new Set(slotResult.staff.flatMap((s) => s.slots))].sort();
}

/** Statuses whose segments occupy staff time during availability checks. */
export const OCCUPYING_BOOKING_STATUSES = ['pending', 'confirmed'];
