# Phase 03 — Completion Summary: Availability Engine

**Document:** `docs/implementation-log/phase-03-summary.md`
**Status:** Completed & Verified
**Date:** 2026-10-30

---

## 1. Scope Delivered

Phase 03 per `docs/implementation-phases.md`: *"Availability engine: recurring
hours, exceptions, time zones/DST, shifts/breaks/leave, qualifications,
durations/buffers, notice/horizon."* All shipped as backend (+ endpoints) slices.

| Increment | Deliverable | Log | Commit |
|---|---|---|---|
| 01 | DST-correct schedule expansion core + interval math | `phase-03-increment-01-schedule-expansion.md` | `17c173c` |
| 02 | Availability exceptions persistence + owner CRUD + conflict warnings | `phase-03-increment-02-availability-exceptions.md` | `a74837b` |
| 03 | Pure slot engine (duration/buffers/eligibility/notice/horizon/bookings) | `phase-03-increment-03-slot-engine.md` | `90cd3d3` |
| 04 | Availability HTTP surfaces (owner preview + public slots) | `phase-03-increment-04-slots-api.md` | `90cd3d3` |

## 2. Verification State at Phase End

- `npm test` → **114/114 integration tests pass** (52 pre-existing; 27 expansion
  unit; 11 exceptions; 17 slot-engine unit; 7 slots API).
- `npm run lint` → clean.
- **HTTP E2E for increments 02 and 04** against the real server:
  17 and 24 assertions respectively, all passing. Key safety assertions: an
  exception creation never mutates a conflicting booking; a closure empties
  slots without auto-cancelling anything; public responses carry no shift
  templates; draft businesses 404 like the directory profile.
- Architecture unchanged: pure engine modules are stateless; all persisted
  state stays tenant-scoped in MongoDB.

## 3. Key Design Rules Established (binding for Phase 04)

1. **Half-open UTC intervals** for all interval math; business-local
   `YYYY-MM-DD` dates name days.
2. **DST policy:** nonexistent wall times roll forward; ambiguous wall times
   take the first occurrence. Unit-tested on real 2026 NYC transitions.
3. **Exception semantics:** date closure = whole local day; date override =
   new windows (blocked = rest of day); instant block = exact range. Conflict
   warnings are advisory-only: **bookings are never modified by a block**.
4. **Slot contract:** grid anchored at local midnight × `defaultSlotIntervalMinutes`;
   buffered span (duration + buffer per placement: before/after; between ≡ after
   single-segment) must fit fully inside (staff work ∩ business open − bookings
   − service blocks); notice/horizon clamps applied.
5. **Reads are advisory:** the booking write path must revalidate through the
   engine inputs and enforce atomic staff-interval exclusivity itself — no
   read response, cache, or rate limiter can authorize a booking commit.
6. `requiredQualifications` added to services; staff must hold all of them;
   `eligibleStaffIds` empty = all active staff.

## 4. Known Issues Carried Into Phase 04

- `uniq_booking_idempotency` collides on `null` keys within a tenant
  (E11000) — booking writes must always provide keys or the index needs a
  partial filter; decide at Phase 04 index design.
- Booking segments are consumed as `{ staffId, service:{serviceId}, startTime,
  endTime }` with `Date` instants (scan + conflict code asserted this shape);
  Phase 04 writes must conform or update those queries.
- Exception conflict-scan loads active bookings per tenant (fine at scale;
  optimize with booking-wide indexes later).
- `between` buffers merge only in the multi-service composer (to build).
- Public nearest-first sorting, ETags (Phase 8). One owner ↔ one business not
  yet enforced.

## 5. Git

Local commits only; no push performed in this phase.
