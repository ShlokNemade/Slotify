import { DateTime } from 'luxon';
import { subtractIntervals, mergeIntervals, isValidInterval } from './intervals.js';

/**
 * Schedule expansion: turns stored recurring schedules (business hours,
 * staff shifts/breaks/leave and date-specific exceptions) into concrete
 * half-open UTC intervals `[start, end)` for a date range.
 *
 * This module is pure (no database, no I/O) so the write path can reuse the
 * same expansion rules and the rules are unit-testable, including DST.
 *
 * ## Interpretation rules
 * - Dates are BUSINESS-LOCAL calendar dates (`YYYY-MM-DD` in the business
 *   IANA time zone). Staff shifts and breaks are wall-clock times in that
 *   same zone (staff are owner-managed records without a personal zone).
 * - Staff `leave` entries are instant-based (`startDate`/`endDate` with
 *   offset) because leave can start/finish mid-"day" in any zone.
 * - Windows are same-day wall-clock windows (`open < close`); windows that
 *   span or touch midnight (`open >= close`) are unsupported and skipped.
 *
 * ## DST policy (explicit, unit-tested)
 * - **Spring-forward gap:** a wall-clock time that does not exist locally
 *   (e.g. 02:30 on the US spring-forward day) is resolved to the earliest
 *   instant that is still at-or-after the requested wall time: Luxon maps
 *   the non-existent wall time to the transition gap's post-instant,
 *   effectively rolling forward (02:30 -> 03:30). Windows whose interior is
 *   annihilated by the gap therefore shrink instead of erroring.
 * - **Fall-back ambiguity:** a wall-clock time that occurs twice (e.g. 01:30
 *   on the US fall-back day) resolves to the FIRST occurrence (earlier
 *   offset). Windows never stretch into the second occurrence.
 *
 * These policies trade exact duration preservation for determinism: a slot
 * computed near a DST transition always refers to a single, unambiguous
 * instant set.
 */

const DAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse a business-local calendar date.
 * @param {string} dateISO `YYYY-MM-DD`
 * @returns {{ year: number, month: number, day: number }}
 */
function parseCalendarDate(dateISO) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) {
    throw new Error(`Invalid calendar date: "${dateISO}" (expected YYYY-MM-DD)`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Day-of-week name for a business-local calendar date.
 * @param {string} dateISO
 * @param {string} timeZone
 * @returns {string} lowercase weekday name
 */
export function dayNameForDate(dateISO, timeZone) {
  const { year, month, day } = parseCalendarDate(dateISO);
  // Noon avoids any boundary effect; the date has no wall time component.
  const dt = DateTime.fromObject({ year, month, day, hour: 12 }, { zone: timeZone });
  if (!dt.isValid) {
    throw new Error(`Unknown IANA time zone: "${timeZone}"`);
  }
  return DAY_NAMES[(dt.weekday - 1 + 7) % 7];
}

/**
 * Convert a wall-clock time on a business-local date into a UTC instant,
 * applying the documented DST policies.
 * @param {string} dateISO
 * @param {string} hhmm `HH:mm`
 * @param {string} timeZone
 * @returns {Date}
 */
export function wallTimeToInstant(dateISO, hhmm, timeZone) {
  const { year, month, day } = parseCalendarDate(dateISO);
  const match = HHMM_PATTERN.exec(hhmm);
  if (!match) {
    throw new Error(`Invalid wall time: "${hhmm}" (expected HH:mm)`);
  }
  const dt = DateTime.fromObject(
    { year, month, day, hour: Number(match[1]), minute: Number(match[2]) },
    { zone: timeZone }
  );
  if (!dt.isValid) {
    throw new Error(`Unknown IANA time zone: "${timeZone}"`);
  }
  return dt.toJSDate();
}

/**
 * Expand same-day wall-clock windows into UTC intervals. Windows that are
 * invalid for booking math (`open >= close`, malformed) are skipped.
 * @param {string} dateISO
 * @param {Array<{open: string, close: string}>} windows
 * @param {string} timeZone
 * @returns {Array<{start: Date, end: Date}>}
 */
export function windowsToUtcIntervals(dateISO, windows, timeZone) {
  if (!Array.isArray(windows)) return [];
  const result = [];
  for (const window of windows) {
    if (!window || !HHMM_PATTERN.test(window.open ?? '') || !HHMM_PATTERN.test(window.close ?? '')) {
      continue;
    }
    const start = wallTimeToInstant(dateISO, window.open, timeZone);
    const end = wallTimeToInstant(dateISO, window.close, timeZone);
    // Same-day windows only. A collapsed window (e.g. 22:00-22:00) or
    // reversed window (new year rollover) yields start >= end -> skip.
    if (start.getTime() < end.getTime()) {
      result.push({ start, end });
    }
  }
  return result;
}

/**
 * All business-local calendar dates in `[fromDate, toDate]` (inclusive).
 * @param {string} timeZone
 * @param {string} fromDate `YYYY-MM-DD` business-local
 * @param {string} toDate `YYYY-MM-DD` business-local inclusive
 * @returns {string[]}
 */
export function businessDatesBetween(timeZone, fromDate, toDate) {
  const start = parseCalendarDate(fromDate);
  const end = parseCalendarDate(toDate);
  let cursor = DateTime.fromObject({ ...start, hour: 12 }, { zone: timeZone });
  const last = DateTime.fromObject({ ...end, hour: 12 }, { zone: timeZone });
  if (!cursor.isValid || !last.isValid) {
    throw new Error(`Unknown IANA time zone: "${timeZone}"`);
  }
  if (cursor > last) return [];
  const dates = [];
  while (cursor <= last) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

/**
 * A date-scoped or instant-scoped exception record, normalized shape
 * prepared for Phase 03 increment 02 persistence:
 * - Date-scoped: `{ date, isOpen?, windows?, staffId?, serviceId? }` —
 *   replaces the normal hours (or staff shift windows) on that date.
 *   Absent `windows` with `isOpen: false` means fully closed/unavailable.
 * - Instant-scoped: `{ startDateTime, endDateTime, staffId?, serviceId? }` —
 *   removes a concrete instant range (half-day closure, extra holiday).
 * @typedef {Object} ScheduleException
 */

/**
 * Decide the source "open windows" for a business on a given date:
 * a date-scoped exception (if any) replaces the weekly recurring hours.
 * @param {string} dateISO
 * @param {string} timeZone
 * @param {Record<string, {isOpen: boolean, windows: Array<{open: string, close: string}>}>} hours
 * @param {ScheduleException[]} exceptions
 * @returns {Array<{start: Date, end: Date}>} open intervals (may be empty)
 */
function businessOpenIntervalsForDate(dateISO, timeZone, hours, exceptions) {
  const exception = (exceptions ?? []).find(
    (e) => !e.staffId && !e.serviceId && e.date === dateISO
  );

  let source;
  if (exception) {
    if (exception.isOpen === false) return [];
    source = exception.windows ?? [];
  } else {
    const dayConfig = hours?.[dayNameForDate(dateISO, timeZone)];
    if (!dayConfig?.isOpen) return [];
    source = dayConfig.windows ?? [];
  }

  return mergeIntervals(windowsToUtcIntervals(dateISO, source, timeZone));
}

/**
 * Expand the business's public open intervals over a date range,
 * applying business-wide (scope-less) date exceptions and instant blocks.
 * @param {object} params
 * @param {string} params.timeZone business IANA zone
 * @param {Record<string, {isOpen: boolean, windows: Array}>} params.hours weekly recurring hours
 * @param {ScheduleException[]} [params.exceptions] business-wide exceptions
 * @param {string} params.fromDate business-local inclusive
 * @param {string} params.toDate business-local inclusive
 * @returns {Array<{start: Date, end: Date}>} sorted merged open intervals
 */
export function expandBusinessOpenIntervals({ timeZone, hours, exceptions = [], fromDate, toDate }) {
  const result = [];
  for (const dateISO of businessDatesBetween(timeZone, fromDate, toDate)) {
    result.push(...businessOpenIntervalsForDate(dateISO, timeZone, hours, exceptions));
  }

  // Instant-scoped business-wide blocks remove concrete ranges.
  const blocks = (exceptions ?? [])
    .filter((e) => !e.staffId && !e.serviceId && e.startDateTime && e.endDateTime)
    .map((e) => ({ start: new Date(e.startDateTime), end: new Date(e.endDateTime) }))
    .filter(isValidInterval);

  return subtractIntervals(result, blocks);
}

/**
 * Shift windows configured for one staff member on one weekday. Staff may
 * have multiple shift entries for the same day; they are unioned.
 * @param {object} staff stored staff document (shifts possible)
 * @param {string} dayName
 * @returns {Array<{open: string, close: string}>}
 */
function staffWindowsForDay(staff, dayName) {
  const entries = (staff?.shifts ?? []).filter((s) => s?.day === dayName);
  return entries.flatMap((s) => s.windows ?? []);
}

/**
 * Break windows for one staff member on one weekday (instant-expanded by the
 * caller together with the shift windows, since breaks are same-day too).
 */
function staffBreaksForDay(staff, dayName) {
  const entries = (staff?.breaks ?? []).filter((b) => b?.day === dayName);
  return entries.map((b) => ({ open: b.start, close: b.end }));
}

/**
 * Instant removals for one staff member: stored leave plus instant-scoped
 * staff exception blocks.
 * @param {object} staff
 * @param {ScheduleException[]} exceptions
 * @returns {Array<{start: Date, end: Date}>}
 */
function staffRemovalIntervals(staff, exceptions) {
  const leave = (staff?.leave ?? [])
    .map((l) => ({ start: new Date(l.startDate), end: new Date(l.endDate) }))
    .filter(isValidInterval);
  const blocks = (exceptions ?? [])
    .filter((e) => e.staffId && String(e.staffId) === String(staff._id) && e.startDateTime && e.endDateTime)
    .map((e) => ({ start: new Date(e.startDateTime), end: new Date(e.endDateTime) }))
    .filter(isValidInterval);
  return [...leave, ...blocks];
}

/**
 * Expand one staff member's working intervals over a date range:
 * shift windows (union across same-day entries) minus breaks, leave and
 * staff-scoped exception blocks. Staff-specific date exceptions replace the
 * recurring shift windows for that date (absence = unavailable all day).
 *
 * Shifts/breaks are wall-clock in the business time zone; the intersection
 * with BUSINESS open hours is a later composition step (slot engine), not
 * done here, so a staff member's own-hours schedule stays intact.
 * @param {object} params
 * @param {object} params.staff stored staff document (with `_id`)
 * @param {string} params.timeZone business IANA zone
 * @param {ScheduleException[]} [params.exceptions] staff- or business-scoped exceptions
 * @param {string} params.fromDate business-local inclusive
 * @param {string} params.toDate business-local inclusive
 * @returns {Array<{start: Date, end: Date}>} sorted merged work intervals
 */
export function expandStaffWorkIntervals({ staff, timeZone, exceptions = [], fromDate, toDate }) {
  const result = [];
  for (const dateISO of businessDatesBetween(timeZone, fromDate, toDate)) {
    const dayName = dayNameForDate(dateISO, timeZone);

    let source;
    const staffException = (exceptions ?? []).find(
      (e) => e.date === dateISO && String(e.staffId ?? '') === String(staff._id)
    );
    if (staffException) {
      if (staffException.isOpen === false) continue;
      source = staffException.windows ?? [];
    } else {
      source = staffWindowsForDay(staff, dayName);
    }

    let dayIntervals = windowsToUtcIntervals(dateISO, source, timeZone);
    // Same-day breaks subtract from the same-day shift windows.
    dayIntervals = subtractIntervals(dayIntervals, windowsToUtcIntervals(dateISO, staffBreaksForDay(staff, dayName), timeZone));
    // Leave + instant-scoped staff blocks subtract wherever they fall.
    dayIntervals = subtractIntervals(dayIntervals, staffRemovalIntervals(staff, exceptions));
    result.push(...dayIntervals);
  }
  return mergeIntervals(result);
}

/**
 * Convenience date parsing for inputs coming from HTTP query strings:
 * accepts `YYYY-MM-DD`, validates, and returns the business-local date.
 * @param {string} value
 * @returns {string} `YYYY-MM-DD`
 */
export function normalizeCalendarDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(String(value ?? ''));
  if (!match) {
    throw new Error(`Invalid date: "${value}" (expected YYYY-MM-DD)`);
  }
  const dt = DateTime.fromObject(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
    { zone: 'utc' }
  );
  if (!dt.isValid) {
    throw new Error(`Invalid date: "${value}"`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}
