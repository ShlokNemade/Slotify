# Phase 03 — Increment 01: Schedule Expansion Core (DST-Correct)

**Document:** `docs/implementation-log/phase-03-increment-01-schedule-expansion.md`
**Status:** Completed & Verified
**Date:** 2026-10-30

---

## 1. Objective

The foundation increment of the **Phase 03 availability engine**: pure, database-free
functions that expand stored recurring schedules — business weekly hours, staff shifts,
breaks, instant-based leave, and date-specific exceptions — into concrete half-open UTC
intervals `[start, end)` for a date range, interpreted in the **business IANA time zone**,
with explicit, unit-tested DST handling.

## 2. Requirements Addressed

- `docs/requirements.md` (Availability): weekly recurring hours + date-specific exceptions;
  staff shifts/breaks/leave; business IANA TZ; store consistent UTC timestamps; "explicitly
  handle DST gaps/repeated times".
- `docs/architecture.md` availability read path, step 1 (expand recurring schedules and
  exceptions in the business time zone). Later steps (notice/horizon, buffers, slot
  candidates, existing bookings) are increments 02–04.
- Acceptance basis: engine math must be provably correct *before* it gates a booking flow.

## 3. Files Changed

| File | Purpose |
|---|---|
| `apps/server/src/services/availability/intervals.js` | **New** — half-open instant interval math: validate/sort/merge/subtract/intersect/overlap/duration |
| `apps/server/src/services/availability/schedule-expansion.js` | **New** — calendar dates, wall-time→UTC conversion, window expansion, business + staff expansion, exception application |
| `apps/server/test/availability-expansion.test.js` | **New** — 27 pure unit tests (no DB) |
| `apps/server/package.json`, root `package-lock.json` | Add `luxon@^3` (server runtime dep) |

## 4. Implementation

- **Interval convention (documented in both modules):** half-open `[start, end)` UTC
  instants (`Date`s). Adjacent intervals never overlap; comparisons are epoch-ms only.
- **Calendar dates are business-local** (`YYYY-MM-DD`); day-of-week derived via Luxon at
  local noon to avoid boundary effects. Staff shifts/breaks are wall-clock HH:mm in the
  business zone (staff have no personal zone — owner-managed records). Staff `leave`
  (stored as offset ISO datetimes since Phase 02) is treated as instant-based removals.
- **DST policy (unit-tested against real transitions):**
  - *Spring-forward gap* (e.g. `America/New_York`, 2026-03-08, 02:00→03:00): a nonexistent
    wall time resolves to the earliest instant at-or-after the requested wall time —
    Luxon's roll-forward (02:30 → 03:30). Windows spanning the gap shrink (01:00–04:00
    becomes a 2-hour interval) rather than erroring.
  - *Fall-back ambiguity* (2026-11-01, 02:00→01:00): ambiguous wall times resolve to the
    **first** occurrence (earlier offset); windows never stretch into the second
    occurrence. A 00:00–03:00 window correctly spans 4 real hours.
- **Exceptions (normalized shape, persisted in increment 02):**
  - Date-scoped: `{ date, isOpen?, windows?, staffId?, serviceId? }` — replaces recurring
    hours (business scope) or shift windows (staff scope); absent windows + `isOpen:false`
    = fully closed/unavailable for that local date.
  - Instant-scoped: `{ startDateTime, endDateTime, staffId?, serviceId? }` — removes a
    concrete UTC range (half-day closure, extra holiday, staff emergency).
  - Scoping is enforced structurally: a `staffId`-scoped exception never closes the
    business (unit-tested both directions).
- **Staff expansion** unions multiple same-day shift entries, subtracts same-day breaks,
  then subtracts leave + staff-scoped instant blocks. Staff work intervals are *not*
  intersected with business hours here — that composition (a slot must be inside both)
  belongs to the slot engine (increment 03), keeping each function single-purpose.
- **Fail-safe inputs:** reversed/midnight-spanning windows (`open >= close`) and malformed
  HH:mm strings are **skipped**, not thrown — a bad owner edit can never crash availability;
  an unknown IANA zone throws (fail-fast; zone is server-validated at business create).

## 5. Design Rationale

- **Pure core first** (no DB, no routes) so rules are unit-testable at zero infrastructure
  cost, and the write path (increment 02 conflict scans) can reuse identical expansion.
- **Half-open intervals** eliminate off-by-one boundaries everywhere downstream (slot
  candidacy, overlap checks, block conflict warnings).
- **Luxon** for wall-time↔instant math: correct IANA database handling, explicit
  invalid/gap/ambiguity behavior; MIT-licensed, pure JS, matches the no-TypeScript rule.
- **Skipped (not rejected) malformed windows:** business-limiting validation belongs in the
  owner-facing schemas; the engine stays defensive but total.

## 6. Architecture & Data Flow

```
stored hours/staff/exceptions  ──expandBusinessOpenIntervals──▶ business open intervals  (UTC [start,end))
                               ──expandStaffWorkIntervals───▶ per-staff work intervals
                                                              (inc 03: intersect + slot candidates
                                                               + notice/horizon/buffers/bookings)
```

## 7. API, Schema, Config, Dependency Changes

- No routes, no DB writes, no shared-schema changes yet.
- New runtime dependency: `luxon@^3` in `@slotify/server`.

## 8. Security & Failure Handling

- No I/O surface; nothing user-facing yet. Regex-validated inputs; unknown timezone =
  explicit throw; invalid exceptions/windows silently skipped (availability errs closed).

## 9. Tests (actual commands and results)

| Command | Result |
|---|---|
| `node --test apps/server/test/availability-expansion.test.js` | **27/27 pass** (first run: 1 failure — my own assertion arithmetic for the ambiguous 01:30 instant; the implementation was correct, test fixed) |
| `npm test` (root) | **79/79 pass** (52 pre-existing + 27 new) |
| `npm run lint` | 0 errors, 0 warnings (removed one unused helper during review) |
| E2E | N/A — no HTTP surface in this increment; nothing observable over the wire |

DST cases covered: spring-forward window shrink, gap roll-forward instant, fall-back
stretch, first-occurrence ambiguity resolution. NYC 2026 transitions used as fixtures
(2026-03-08, 2026-11-01).

## 10. Known Limitations

- Midnight-spanning windows (e.g. 22:00–06:00) are unsupported and skipped — matches the
  Phase 02 schema's same-day windows; an owner cannot actually express them sensibly yet.
- Minimum notice / horizon / buffers / eligibility / existing bookings — increments 02–04.
- `serviceId`-scoped exceptions are parsed by shape but intentionally unused here
  (service-level blocks gate services, not staff availability; used by the slot engine).

## 11. Debugging Guide

- A day unexpectedly closed → check `hours[day].isOpen`, then look for a date-scoped
  exception with `isOpen:false`.
- Times shifted by ±1h near DST → this is the documented policy; check the transition date
  (`America/New_York`: Mar 8 / Nov 1 in 2026).
- Unknown zone error → `timeZone` failed the IANA check; inspect the business document.

## 12. Git Commit

*(hash recorded after commit)*

## 13. Next Increment

**Phase 03 — increment 02:** availability exception/block persistence — shared Zod schema +
`availability_blocks` collection (tenant-scoped, indexes), owner CRUD routes under
`/api/v1/businesses/:businessId/exceptions`, and a **conflict-warning scan** against
confirmed bookings (flag overlapping bookings in the API response; never alter/cancel them
per invariant 5). Integration tests + HTTP E2E required.
