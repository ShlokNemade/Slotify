# Phase 03 — Increment 03: Slot Engine (Pure Computation)

**Document:** `docs/implementation-log/phase-03-increment-03-slot-engine.md`
**Status:** Completed & Verified
**Date:** 2026-10-30

---

## 1. Objective

The composition layer of the availability engine: a pure slot engine that
converts availability intervals into bookable slot candidates for one
service, honoring duration, buffers, staff eligibility/qualifications,
shifts/exceptions, existing active bookings, minimum notice and booking
horizon — all configurable per business, nothing trusted from clients.

## 2. Requirements Addressed

- `docs/requirements.md` (Availability): "Candidate start times follow a
  configured interval and are checked against service duration, buffers,
  staff eligibility, shifts, exceptions, and existing bookings"; notice +
  horizon; per-service buffer before/between/after.
- `docs/architecture.md` availability read path steps 2–4. Results are
  advisory; the Phase 04 write path will revalidate (cache can never
  authorize a booking).

## 3. Files Changed

| File | Purpose |
|---|---|
| `apps/server/src/services/availability/slot-engine.js` | **New** — `computeServiceSlots`, `selectEligibleStaff`, `mergeAnyStaffSlots`, `OCCUPYING_BOOKING_STATUSES` |
| `packages/shared/src/schemas/service.js` | adds optional `requiredQualifications` (≤10 items) to create/update schemas |
| `apps/server/test/availability-slot-engine.test.js` | **New** — 17 pure unit tests |

## 4. Implementation

- **Composition per staff member:**
  `expandStaffWorkIntervals ∩ expandBusinessOpenIntervals` (both exception-
  aware from increment 01) → subtract this staff member's ACTIVE booking
  segments (`pending` + `confirmed` statuses; `OCCUPYING_BOOKING_STATUSES`)
  → subtract service-scoped instant blocks.
- **Slot grid:** anchored at business-local midnight, stepped by
  `defaultSlotIntervalMinutes` (30 → :00/:30). Candidates resolving through
  DST gaps collapse onto valid instants and are deduplicated. The buffered
  service span must fit ENTIRELY inside remaining availability.
- **Buffer semantics (single segment):** `after` → span
  `[start, start+duration+buffer)`; `before` → `[start-buffer, start+duration)`;
  `between` behaves as `after` for one segment — true between-segment buffer
  merging only materializes in the Phase 04 multi-service composer, where a
  shared buffer belongs between adjacent segments. Documented honestly.
- **Horizon clamp:** requested business-local dates outside
  `[now, now + maxHorizonDays)` are dropped before expansion. `minNoticeHours`
  drops candidates with `start < now + notice`.
- **Eligibility (`selectEligibleStaff`):** staff must be active, be in
  `eligibleStaffIds` when non-empty (empty list = all active staff), and
  hold every new `service.requiredQualifications` entry. The qualifications
  list gates matching without any free-text vocabulary assumptions.
- **"Any available" view:** `mergeAnyStaffSlots` unions per-staff slot lists
  (a slot exists if any eligible staff member offers it); actual staff
  resolution (pick one) is the Phase 04 write path's job.
- **booking overlap safety:** durations/buffers mean a booking whose end is
  inside a candidate's buffered span removes that candidate — the caller
  may pass a widened scan window (increment 04 uses a 6h margin).

## 5. Architecture & Data Flow

```
staff   ──(shifts − breaks − leave − own exceptions)──┐
business ──(hours − business exceptions)──────────────┤
                     ∩                                ▼
bookings(active, staff-scoped) ──$subtract────────▶ remaining intervals
                                                      ▼
slot grid (interval) + buffered-span fit + notice/horizon ─▶ per-staff ISO slots
                                                      ▼ mergeAnyStaffSlots ─▶ any-staff view
```

## 6. Tests (actual commands and results)

| Command | Result |
|---|---|
| `node --test apps/server/test/availability-slot-engine.test.js` | **17/17 pass** |
| `npm run lint` | clean |

Coverage: grid walking + counting; closed days; inactive staff; AFTER tail,
BEFORE head, BETWEEN-as-AFTER; notice floor; entirely-noticed-out day;
horizon clamp; booking subtraction (with `cancelled` semantics exercised at
the integration layer); business closure; staff-scoped closure isolation;
service-scoped block; requiredQualifications gate; any-staff union; and a
**spring-forward day case** (window shrinks, grid rolls through the gap,
03:00 EDT is offered, 03:30 not).

During test development, three of my own assertions were wrong about
span-end arithmetic and were corrected against the engine's output
(documented in test comments) — the engine rules were verified first.

| E2E | N/A — pure increment, no HTTP surface (endpoints land in increment 04) |

## 7. Known Limitations

- `between` single-segment semantics (see module doc) — Phase 04 composer
  owns true between-buffer merging.
- The engine assumes booking segment instants are `Date` objects.
- No pagination of slots (callers bound the range to ≤14 days).

## 8. Git Commit

`feat(availability): add pure slot engine and availability slots API` — `90cd3d3`

## 9. Next Increment

**Phase 03 — increment 04:** HTTP surfaces — owner availability preview and
public bookable slots on the directory, wiring persisted staff/services/
exceptions/active bookings into the engine.
