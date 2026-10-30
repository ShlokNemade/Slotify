import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import {
  computeServiceSlots,
  selectEligibleStaff,
  mergeAnyStaffSlots,
} from '../src/services/availability/slot-engine.js';
import { wallTimeToInstant } from '../src/services/availability/schedule-expansion.js';

/** Business-local UTC instant ms for readable assertions. */
const utc = (date, hhmm) => wallTimeToInstant(date, hhmm, 'UTC').getTime();

const BUSINESS_UTC = {
  timeZone: 'UTC',
  hours: Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day, i) => [
      day,
      i === 6
        ? { isOpen: false, windows: [] }
        : { isOpen: true, windows: [{ open: '09:00', close: '17:00' }] },
    ])
  ),
  defaultSlotIntervalMinutes: 30,
  minNoticeHours: 0,
  maxHorizonDays: 60,
};

const STAFF_SHIFT_9_17 = (id = 's1', extra = {}) => ({
  _id: id,
  active: true,
  qualifications: [],
  shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '17:00' }] }],
  breaks: [],
  leave: [],
  ...extra,
});

const SERVICE_60 = (extra = {}) => ({
  _id: 'sv1',
  durationMinutes: 60,
  bufferMinutes: 0,
  bufferPlacement: 'after',
  eligibleStaffIds: [],
  requiredQualifications: [],
  ...extra,
});

// Monday 2026-03-02
const MON = '2026-03-02';
const NOW = utc('2026-03-01', '06:00');

describe('slot engine — selection', () => {
  it('selectEligibleStaff: active + eligible + qualified only', () => {
    const s1 = { _id: 'a', active: true, qualifications: ['senior'] };
    const s2 = { _id: 'b', active: true, qualifications: [] };
    const s3 = { _id: 'c', active: false, qualifications: ['senior'] };
    const service = { eligibleStaffIds: [], requiredQualifications: ['senior'] };
    assert.deepEqual(selectEligibleStaff(service, [s1, s2, s3]).map((s) => s._id), ['a']);
    const openService = { eligibleStaffIds: ['a'], requiredQualifications: [] };
    assert.deepEqual(selectEligibleStaff(openService, [s1, s2, s3]).map((s) => s._id), ['a']);
  });
});

describe('slot engine — basic grid & counting', () => {
  it('walks the 30-minute grid and honors service duration', () => {
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60(),
      staff: [STAFF_SHIFT_9_17()],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    assert.equal(result.staff.length, 1);
    assert.equal(result.staff[0].slots.length, 15); // 09:00 .. 16:00
    assert.equal(result.staff[0].slots[0], new Date(utc(MON, '09:00')).toISOString());
    assert.equal(result.staff[0].slots.at(-1), new Date(utc(MON, '16:00')).toISOString());
  });

  it('closed days produce no slots', () => {
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60(),
      staff: [
        { ...STAFF_SHIFT_9_17(), shifts: [{ day: 'sunday', windows: [{ open: '09:00', close: '17:00' }] }] },
      ],
      fromDate: '2026-03-08', // Sunday (business closed, staff works)
      toDate: '2026-03-08',
      now: new Date(NOW),
    });
    assert.equal(result.staff[0].slots.length, 0);
  });

  it('inactive staff get no entry at all', () => {
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60(),
      staff: [STAFF_SHIFT_9_17('s1', { active: false })],
      fromDate: MON,
      toDate: MON,
    });
    assert.equal(result.staff.length, 0);
  });
});

describe('slot engine — buffers', () => {
  it('AFTER buffer shortens the usable tail (last start earlier)', () => {
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60({ bufferMinutes: 30 }),
      staff: [STAFF_SHIFT_9_17()],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    assert.equal(result.staff[0].slots.length, 14); // 09:00 .. 15:30
    assert.equal(result.staff[0].slots.at(-1), new Date(utc(MON, '15:30')).toISOString());
  });

  it('BEFORE buffer shortens the usable head (first start later)', () => {    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60({ bufferMinutes: 30, bufferPlacement: 'before' }),
      staff: [STAFF_SHIFT_9_17()],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    assert.equal(result.staff[0].slots.length, 14);
    assert.equal(result.staff[0].slots[0], new Date(utc(MON, '09:30')).toISOString());
  });

  it('BETWEEN acts as AFTER for a single segment', () => {
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60({ bufferMinutes: 30, bufferPlacement: 'between' }),
      staff: [STAFF_SHIFT_9_17()],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    assert.equal(result.staff[0].slots.at(-1), new Date(utc(MON, '15:30')).toISOString());
  });
});

describe('slot engine — notice & horizon', () => {
  it('drops candidates earlier than minNoticeHours', () => {
    // now = Monday 10:00Z, notice 2h: candidates before 12:00 removed.
    const result = computeServiceSlots({
      business: { ...BUSINESS_UTC, minNoticeHours: 2 },
      service: SERVICE_60(),
      staff: [STAFF_SHIFT_9_17()],
      fromDate: MON,
      toDate: MON,
      now: new Date(utc(MON, '10:00')),
    });
    assert.equal(result.staff[0].slots[0], new Date(utc(MON, '12:00')).toISOString());
  });

  it('clamps today out when inside the notice window entirely', () => {
    // now = Monday 16:30Z, notice 2h → floor 18:30Z after hours end.
    const result = computeServiceSlots({
      business: { ...BUSINESS_UTC, minNoticeHours: 2 },
      service: SERVICE_60(),
      staff: [STAFF_SHIFT_9_17()],
      fromDate: MON,
      toDate: MON,
      now: new Date(utc(MON, '16:30')),
    });
    assert.equal(result.staff[0].slots.length, 0);
  });

  it('clamps the range to maxHorizonDays', () => {
    // Horizon 10 days from 2026-03-01 → latest bookable date 2026-03-10.
    const result = computeServiceSlots({
      business: { ...BUSINESS_UTC, maxHorizonDays: 10 },
      service: SERVICE_60(),
      staff: [STAFF_SHIFT_9_17()],
      fromDate: '2026-03-08',
      toDate: '2026-03-20',
      now: new Date(NOW),
    });
    // Horizon end = 2026-03-10; only Monday 03-09 has both open business and
    // a staff shift (03-08 Sunday business-closed, 03-10 no staff shift).
    assert.equal(result.staff[0].slots.length, 15);
  });
});

describe('slot engine — bookings & exceptions & services', () => {
  it('removes intervals covered by active bookings; cancelled ignored', async () => {
    const staffId = new ObjectId().toString();
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60(),
      staff: [
        STAFF_SHIFT_9_17(staffId, {
          shifts: [{ day: 'monday', windows: [{ open: '09:00', close: '12:00' }] }],
        }),
      ],
      // Active booking 10:00-11:30 removes 10:00,10:30,11:00 starts.
      bookedSegments: [
        { staffId, startTime: new Date(utc(MON, '10:00')), endTime: new Date(utc(MON, '11:30')) },
      ],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    // Remainder: [09:00-10:00] and [11:30-12:00]; only 09:00 fits a 60-min slot.
    assert.deepEqual(result.staff[0].slots, [new Date(utc(MON, '09:00')).toISOString()]);
  });

  it('business closure exception empties the day', () => {
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60(),
      staff: [STAFF_SHIFT_9_17()],
      exceptions: [{ date: MON, isOpen: false }],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    assert.equal(result.staff[0].slots.length, 0);
  });

  it('staff-scoped closure empties that staff (others keep slots)', () => {
    const a = new ObjectId().toString();
    const b = new ObjectId().toString();
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60(),
      staff: [STAFF_SHIFT_9_17(a), STAFF_SHIFT_9_17(b)],
      exceptions: [{ date: MON, isOpen: false, staffId: a }],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    const byId = Object.fromEntries(result.staff.map((s) => [s.staffId, s.slots]));
    assert.equal(byId[a].length, 0);
    assert.equal(byId[b].length, 15);
  });

  it('service-scoped block removes slots for that service only', async () => {
    const serviceId = new ObjectId().toString();
    const blocked = [utc(MON, '10:00'), utc(MON, '11:00')];
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60({ _id: serviceId }),
      staff: [STAFF_SHIFT_9_17()],
      exceptions: [
        {
          startDateTime: new Date(blocked[0]).toISOString(),
          endDateTime: new Date(blocked[1]).toISOString(),
          serviceId,
        },
      ],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    const slots = result.staff[0].slots;
    // 09:00 fits exactly; 09:30-10:30 blocked; from 11:00 the rest returns.
    assert.equal(slots[0], new Date(utc(MON, '09:00')).toISOString());
    assert.equal(slots[1], new Date(utc(MON, '11:00')).toISOString());
    assert.equal(slots.at(-1), new Date(utc(MON, '16:00')).toISOString());
    assert.equal(slots.length, 12);
  });

  it('requiredQualifications gate staff', () => {
    const qualified = STAFF_SHIFT_9_17('q', { qualifications: ['senior'] });
    const junior = STAFF_SHIFT_9_17('j', { qualifications: [] });
    const result = computeServiceSlots({
      business: BUSINESS_UTC,
      service: SERVICE_60({ requiredQualifications: ['senior'] }),
      staff: [qualified, junior],
      fromDate: MON,
      toDate: MON,
      now: new Date(NOW),
    });
    assert.deepEqual(result.staff.map((s) => s.staffId), ['q']);
  });

  it('mergeAnyStaffSlots unions distinct instants across staff', () => {
    const merged = mergeAnyStaffSlots({
      staff: [
        { staffId: 'a', slots: ['A', 'B'] },
        { staffId: 'b', slots: ['B', 'C'] },
      ],
    });
    assert.deepEqual(merged, ['A', 'B', 'C']);
  });
});

describe('slot engine — DST (America/New_York)', () => {
  const BUSINESS_NY = {
    ...BUSINESS_UTC,
    timeZone: 'America/New_York',
    hours: {
      ...BUSINESS_UTC.hours,
      // Spring-forward Sunday: window shrinks to 1:00-4:00 wall / 2 real hours.
      sunday: { isOpen: true, windows: [{ open: '01:00', close: '04:00' }] },
    },
  };

  it('offers only valid instants on the spring-forward day (deduped, 60-min service)', () => {
    // Business local day 2026-03-08; 60-min service; interval 30.
    // Grid 01:00(06:00Z), 01:30(06:30Z), 02:00→03:00(07:00Z), 02:30→03:30 —
    // 03:30+60min = 04:00 EDT (08:00Z) fits. So distinct fitting starts:
    // 01:00, 01:30, 03:00, 03:30 EDT.
    const staff = STAFF_SHIFT_9_17('nys', {
      shifts: [{ day: 'sunday', windows: [{ open: '01:00', close: '04:00' }] }],
    });
    const result = computeServiceSlots({
      business: BUSINESS_NY,
      service: SERVICE_60(),
      staff: [staff],
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
      now: new Date(NOW),
    });
    const instants = result.staff[0].slots.map((iso) => new Date(iso).getTime());
    // Explicit UTC instants: 01:00 EST = 06:00Z, 01:30 EST = 06:30Z,
    // offset 120min rolls through the gap to 03:00 EDT = 07:00Z; the
    // 03:30 start's buffered span (07:30-08:30Z) exceeds the window end.
    assert.deepEqual(instants.length, 3);
    assert.deepEqual(instants, [
      new Date('2026-03-08T06:00:00Z').getTime(),
      new Date('2026-03-08T06:30:00Z').getTime(),
      new Date('2026-03-08T07:00:00Z').getTime(),
    ]);
  });
});
