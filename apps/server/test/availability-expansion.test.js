import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandBusinessOpenIntervals,
  expandStaffWorkIntervals,
  businessDatesBetween,
  wallTimeToInstant,
  normalizeCalendarDateInput,
} from '../src/services/availability/schedule-expansion.js';
import {
  mergeIntervals,
  subtractIntervals,
  intersectIntervalLists,
  intervalsOverlap,
  totalDurationMs,
} from '../src/services/availability/intervals.js';
import { DateTime } from 'luxon';

/** Fixed-UTC millisecond helper for readable assertions. */
const utc = (date, hhmm) =>
  wallTimeToInstant(date, hhmm, 'UTC').getTime();

const WEEK = (open = null, close = null) =>
  Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => [
      day,
      open && close ? { isOpen: true, windows: [{ open, close }] } : { isOpen: false, windows: [] },
    ])
  );

describe('availability interval math', () => {
  it('merges overlapping and touching intervals', () => {
    const merged = mergeIntervals([
      { start: new Date(0), end: new Date(10) },
      { start: new Date(10), end: new Date(20) },
      { start: new Date(30), end: new Date(40) },
    ]);
    assert.deepEqual(
      merged.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[0, 20], [30, 40]]
    );
  });

  it('subtracts removals splitting base intervals', () => {
    const result = subtractIntervals(
      [{ start: new Date(0), end: new Date(100) }],
      [{ start: new Date(40), end: new Date(60) }]
    );
    assert.deepEqual(
      result.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[0, 40], [60, 100]]
    );
  });

  it('subtracts nothing when removal misses base', () => {
    const result = subtractIntervals(
      [{ start: new Date(0), end: new Date(10) }],
      [{ start: new Date(50), end: new Date(60) }]
    );
    assert.equal(result.length, 1);
  });

  it('intersects two lists correctly', () => {
    const result = intersectIntervalLists(
      [{ start: new Date(0), end: new Date(50) }],
      [{ start: new Date(30), end: new Date(80) }]
    );
    assert.deepEqual(
      result.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[30, 50]]
    );
  });

  it('overlap is half-open: touching endpoints do not overlap', () => {
    const a = { start: new Date(0), end: new Date(10) };
    const b = { start: new Date(10), end: new Date(20) };
    assert.equal(intervalsOverlap(a, b), false);
  });

  it('total duration is overlap-safe', () => {
    const ms = totalDurationMs([
      { start: new Date(0), end: new Date(50) },
      { start: new Date(40), end: new Date(80) },
    ]);
    assert.equal(ms, 80);
  });
});

describe('calendar helpers', () => {
  it('enumerates business-local dates inclusively', () => {
    const dates = businessDatesBetween('UTC', '2026-03-06', '2026-03-10');
    assert.deepEqual(dates, ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('returns an empty list when reversed', () => {
    assert.deepEqual(businessDatesBetween('UTC', '2026-03-10', '2026-03-06'), []);
  });

  it('normalizes date input variants', () => {
    assert.equal(normalizeCalendarDateInput('2026-03-08'), '2026-03-08');
    assert.throws(() => normalizeCalendarDateInput('2026-13-40'), /Invalid date/);
  });
});

describe('business hours expansion (UTC business)', () => {
  it('expands weekly recurring open windows as UTC instants', () => {
    // Wednesday 2026-03-04
    const intervals = expandBusinessOpenIntervals({
      timeZone: 'UTC',
      hours: WEEK('09:00', '17:00'),
      fromDate: '2026-03-04',
      toDate: '2026-03-04',
    });
    assert.deepEqual(
      intervals.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[utc('2026-03-04', '09:00'), utc('2026-03-04', '17:00')]]
    );
  });

  it('yields nothing on closed days', () => {
    const intervals = expandBusinessOpenIntervals({
      timeZone: 'UTC',
      hours: WEEK(),
      fromDate: '2026-03-08', // Sunday, closed
      toDate: '2026-03-08',
    });
    assert.deepEqual(intervals, []);
  });

  it('iterates multiple days and only opens scheduled ones', () => {
    const intervals = expandBusinessOpenIntervals({
      timeZone: 'UTC',
      hours: { ...WEEK(), saturday: { isOpen: true, windows: [{ open: '10:00', close: '14:00' }] } },
      fromDate: '2026-03-07', // Saturday
      toDate: '2026-03-08', // Sunday (closed)
    });
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].start.getTime(), utc('2026-03-07', '10:00'));
  });
});

describe('time zone conversion (America/New_York)', () => {
  it('converts regular EST winter dates by -05:00', () => {
    // Monday 2026-01-05
    const intervals = expandBusinessOpenIntervals({
      timeZone: 'America/New_York',
      hours: WEEK('09:00', '17:00'),
      fromDate: '2026-01-05',
      toDate: '2026-01-05',
    });
    const expectation = DateTime.fromObject(
      { year: 2026, month: 1, day: 5, hour: 9 },
      { zone: 'America/New_York' }
    );
    assert.equal(intervals[0].start.getTime(), expectation.toJSDate().getTime());
    assert.equal(intervals[0].end.getTime(), expectation.plus({ hours: 8 }).toJSDate().getTime());
  });

  it('shrinks a window through the spring-forward gap (2026-03-08)', () => {
    // US spring forward: 02:00 -> 03:00 local. Window 01:00-04:00 loses one hour.
    const intervals = expandBusinessOpenIntervals({
      timeZone: 'America/New_York',
      hours: { ...WEEK(), sunday: { isOpen: true, windows: [{ open: '01:00', close: '04:00' }] } },
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
    });
    assert.equal(intervals.length, 1);
    const start = DateTime.fromObject({ year: 2026, month: 3, day: 8, hour: 1 }, { zone: 'America/New_York' }).toJSDate().getTime();
    const end = DateTime.fromObject({ year: 2026, month: 3, day: 8, hour: 4 }, { zone: 'America/New_York' }).toJSDate().getTime();
    assert.equal(intervals[0].start.getTime(), start);
    assert.equal(intervals[0].end.getTime(), end);
    assert.equal(intervals[0].end.getTime() - intervals[0].start.getTime(), 2 * 3600_000);
  });

  it('rolls forward a nonexistent wall time (02:30 -> 03:30)', () => {
    const instant = wallTimeToInstant('2026-03-08', '02:30', 'America/New_York');
    const expected = DateTime.fromObject({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, { zone: 'America/New_York' });
    assert.equal(instant.getTime(), expected.toJSDate().getTime());
  });

  it('stretches a window across the fall-back ambiguity (2026-11-01)', () => {
    // US fall back: 02:00 -> 01:00 local. Window 00:00-03:00 is 4 real hours.
    const intervals = expandBusinessOpenIntervals({
      timeZone: 'America/New_York',
      hours: { ...WEEK(), sunday: { isOpen: true, windows: [{ open: '00:00', close: '03:00' }] } },
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
    });
    assert.equal(intervals.length, 1);
    const start = DateTime.fromObject({ year: 2026, month: 11, day: 1, hour: 0 }, { zone: 'America/New_York' }).toJSDate().getTime();
    const end = DateTime.fromObject({ year: 2026, month: 11, day: 1, hour: 3 }, { zone: 'America/New_York' }).toJSDate().getTime();
    assert.equal(intervals[0].start.getTime(), start);
    assert.equal(intervals[0].end.getTime(), end);
    assert.equal(intervals[0].end.getTime() - intervals[0].start.getTime(), 4 * 3600_000);
  });

  it('resolves an ambiguous wall time to the FIRST occurrence', () => {
    const instant = wallTimeToInstant('2026-11-01', '01:30', 'America/New_York');
    const firstOccurrence = 5.5 * 3600_000; // 01:30 EDT = 05:30Z on 2026-11-01
    const base = DateTime.fromObject({ year: 2026, month: 11, day: 1 }, { zone: 'utc' }).toJSDate().getTime();
    assert.equal(instant.getTime(), base + firstOccurrence);
  });
});

describe('malformed window handling', () => {
  it('skips reversed or midnight-spanning windows rather than failing', () => {
    const intervals = expandBusinessOpenIntervals({
      timeZone: 'UTC',
      hours: {
        ...WEEK(),
        thursday: {
          isOpen: true,
          windows: [{ open: '22:00', close: '06:00' }, { open: '09:00', close: '12:00' }],
        },
      },
      fromDate: '2026-03-05',
      toDate: '2026-03-05',
    });
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].start.getTime(), utc('2026-03-05', '09:00'));
  });
});

describe('business date exceptions', () => {
  const EXCEPTIONS_BASE = { timeZone: 'UTC', hours: WEEK('09:00', '17:00') };

  it('a closure exception removes the whole day', () => {
    const intervals = expandBusinessOpenIntervals({
      ...EXCEPTIONS_BASE,
      exceptions: [{ date: '2026-03-04', isOpen: false }],
      fromDate: '2026-03-04',
      toDate: '2026-03-04',
    });
    assert.deepEqual(intervals, []);
  });

  it('an override exception replaces hours for that date only', () => {
    const intervals = expandBusinessOpenIntervals({
      ...EXCEPTIONS_BASE,
      exceptions: [{ date: '2026-03-04', isOpen: true, windows: [{ open: '10:00', close: '14:00' }] }],
      fromDate: '2026-03-04',
      toDate: '2026-03-04',
    });
    assert.deepEqual(
      intervals.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[utc('2026-03-04', '10:00'), utc('2026-03-04', '14:00')]]
    );
  });

  it('an instant-scoped business block removes a concrete range from open hours', () => {
    const intervals = expandBusinessOpenIntervals({
      ...EXCEPTIONS_BASE,
      exceptions: [
        {
          startDateTime: new Date(utc('2026-03-04', '11:00')).toISOString(),
          endDateTime: new Date(utc('2026-03-04', '13:00')).toISOString(),
        },
      ],
      fromDate: '2026-03-04',
      toDate: '2026-03-04',
    });
    assert.deepEqual(
      intervals.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[utc('2026-03-04', '09:00'), utc('2026-03-04', '11:00')], [utc('2026-03-04', '13:00'), utc('2026-03-04', '17:00')]]
    );
  });
});

describe('staff work expansion', () => {
  const STAFF_SHIFT_DAY = {
    ...WEEK(),
    monday: { isOpen: true, windows: [{ open: '09:00', close: '17:00' }] },
  };

  it('expands a staff shift in the business time zone (UTC business)', () => {
    const staff = { _id: 's1', shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }] };
    const intervals = expandStaffWorkIntervals({
      staff,
      timeZone: 'UTC',
      fromDate: '2026-03-02', // Monday
      toDate: '2026-03-02',
    });
    assert.deepEqual(
      intervals.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[utc('2026-03-02', '09:00'), utc('2026-03-02', '17:00')]]
    );
  });

  it('subtracts same-day breaks from shift windows', () => {
    const staff = {
      _id: 's2',
      shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }],
      breaks: [{ day: 'monday', start: '12:00', end: '13:00' }],
    };
    const intervals = expandStaffWorkIntervals({
      staff,
      timeZone: 'UTC',
      fromDate: '2026-03-02',
      toDate: '2026-03-02',
    });
    assert.deepEqual(
      intervals.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[utc('2026-03-02', '09:00'), utc('2026-03-02', '12:00')], [utc('2026-03-02', '13:00'), utc('2026-03-02', '17:00')]]
    );
  });

  it('unions multiple shift entries on the same day', () => {
    const staff = {
      _id: 's3',
      shifts: [
        { day: 'monday', windows: [{ open: '09:00', close: '12:00' }] },
        { day: 'monday', windows: [{ open: '11:00', close: '15:00' }] },
      ],
    };
    const intervals = expandStaffWorkIntervals({
      staff,
      timeZone: 'UTC',
      fromDate: '2026-03-02',
      toDate: '2026-03-02',
    });
    assert.deepEqual(
      intervals.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[utc('2026-03-02', '09:00'), utc('2026-03-02', '15:00')]]
    );
  });

  it('subtracts instant-based leave overlapping the shift', () => {
    const staff = {
      _id: 's4',
      shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }],
      leave: [
        {
          startDate: new Date(utc('2026-03-02', '13:00')).toISOString(),
          endDate: new Date(utc('2026-03-02', '18:00')).toISOString(),
        },
      ],
    };
    const intervals = expandStaffWorkIntervals({
      staff,
      timeZone: 'UTC',
      fromDate: '2026-03-02',
      toDate: '2026-03-02',
    });
    assert.deepEqual(
      intervals.map((i) => [i.start.getTime(), i.end.getTime()]),
      [[utc('2026-03-02', '09:00'), utc('2026-03-02', '13:00')]]
    );
  });

  it('a staff-scoped date closure removes the whole day for that staff member, business still open', () => {
    const staff = { _id: 's5', shifts: STAFF_SHIFT_DAY.monday.windows.map((w) => ({ day: 'monday', windows: [w] })) };
    const businessIntervals = expandBusinessOpenIntervals({
      timeZone: 'UTC',
      hours: STAFF_SHIFT_DAY,
      exceptions: [{ date: '2026-03-02', staffId: 's5', isOpen: false }],
      fromDate: '2026-03-02',
      toDate: '2026-03-02',
    });
    // staffId-scoped exception must NOT close the business
    assert.equal(businessIntervals.length, 1);

    const staffIntervals = expandStaffWorkIntervals({
      staff,
      timeZone: 'UTC',
      exceptions: [{ date: '2026-03-02', staffId: 's5', isOpen: false }],
      fromDate: '2026-03-02',
      toDate: '2026-03-02',
    });
    assert.deepEqual(staffIntervals, []);
  });

  it('does not apply another staff member\'s exception', () => {
    const staff = { _id: 's6', shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }] };
    const intervals = expandStaffWorkIntervals({
      staff,
      timeZone: 'UTC',
      exceptions: [{ date: '2026-03-02', staffId: 'someone-else', isOpen: false }],
      fromDate: '2026-03-02',
      toDate: '2026-03-02',
    });
    assert.equal(intervals.length, 1);
  });
});
