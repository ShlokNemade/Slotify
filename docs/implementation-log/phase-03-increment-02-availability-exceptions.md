# Phase 03 — Increment 02: Availability Exceptions (Blocks & Overrides)

**Document:** `docs/implementation-log/phase-03-increment-02-availability-exceptions.md`
**Status:** Completed & Verified
**Date:** 2026-10-30

---

## 1. Objective

Persist schedule exceptions/blocks (closures, hour overrides, staff absences,
service unavailability, instant blocks) with tenant-scoped owner CRUD, and
warn owners about existing active bookings that would conflict — **flagging
only, never altering bookings** (invariant 5).

## 2. Requirements Addressed

- `docs/requirements.md` (Availability): business-wide / staff-specific /
  service-specific blocks; date-specific exceptions; one-off overrides;
  "Warn and flag existing booking conflicts when adding blocks; never
  silently alter or cancel bookings."
- `docs/data-api.md`: `AvailabilityBlock/Exception` entity ("business,
  optional staff/service scope, interval/recurrence, reason").
- Acceptance criteria #6 and #9 (booking conflicts never silent; cross-tenant
  rejected).

## 3. Files Changed

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/availability.js` | **New** — create/update/list Zod schemas with strict cross-field rules |
| `packages/shared/src/index.js` | exports the new schemas |
| `apps/server/src/services/exception-service.js` | **New** — CRUD, scope reference validation, conflict scan |
| `apps/server/src/services/exception-projection.js` | **New** — allowlisted owner projection |
| `apps/server/src/routes/exception-routes.js` | **New** — `POST/GET /`, `GET/PATCH/DELETE /:id` |
| `apps/server/src/app.js` | mounts `/api/v1/businesses/:businessId/exceptions` |
| `apps/server/src/db/mongo.js` | indexes `idx_exceptions_business_date/staff/service` |
| `apps/server/src/services/availability/schedule-expansion.js` | adds `nextCalendarDate` helper |
| `apps/server/test/availability-exceptions.test.js` | **New** — 11 integration tests |

## 4. Implementation

- **Two temporal forms** (exactly one, enforced by Zod refinement):
  - *Date-scoped:* `{ date: YYYY-MM-DD, isOpen?, windows? }` in business-local
    time; `isOpen:false` = full-day closure; `isOpen:true` + windows =
    override hours.
  - *Instant-scoped:* `{ startDateTime, endDateTime }` ISO instants (UTC) —
    half-day closures, one-off maintenance blocks.
- **Scope levels:** none (business-wide), `staffId`, or `serviceId` (mutually
  exclusive by schema). Scope ids are stored as `ObjectId` so tenant lookups
  and filtering are type-consistent.
- **Conflict scan (`blockedIntervalsForException` + `findBookingConflicts`):**
  computes what time becomes unavailable (closure → whole local day; override
  → day minus new windows; instant block → exact range), then queries
  ACTIVE bookings (`pending` + `confirmed`) via `$elemMatch` overlap on
  `segments`, respecting staff/service scope. Response embeds `conflicts`
  (bookingId, status, minified segments). Read-only: verified by tests that
  the booking document is byte-identical afterwards.
- **Immutability on PATCH:** scope (`staffId`/`serviceId`) and the temporal
  form (`date` vs instants) cannot be patched. Field updates are merged with
  the stored document and re-validated against the full creation schema, so
  cross-field rules (e.g. "closed cannot have windows") are single-sourced.
- **Scope integrity:** `staffId`/`serviceId` must exist inside the tenant
  (404 otherwise) — cross-tenant references impossible.

## 5. API

```
POST   /api/v1/businesses/:businessId/exceptions      → { exception, conflicts }
GET    /api/v1/businesses/:businessId/exceptions?fromDate&toDate&staffId
PATCH  /api/v1/businesses/:businessId/exceptions/:id  → { exception, conflicts }
DELETE /api/v1/businesses/:businessId/exceptions/:id
```
All require `authenticate` + `requireBusinessOwnership`. `conflicts` is a
warning array; `POST`/`PATCH` succeed regardless of conflicts.

## 6. Concurrency & Failure Considerations

- Conflict scan is **advisory and best-effort**: an owner adding blocks while
  a customer concurrently books the same slot can race; the authoritative
  arbiter remains the Phase 04 booking write path, which must consult
  exceptions when revalidating (documented handoff — increment 03 engine
  removes blocked times from slot candidates, and the booking creation must
  recheck).
- Delete is a hard delete of a config record (bookings keep their history;
  exceptions are re-derivable configuration, not audit data).
- `bookings` scan assumes segments store `Date` instants (per shared booking
  schema `isoDateSchema`); flagged for Phase 04 to keep consistent.
- **Phase 04 pitfall discovered:** the existing `uniq_booking_idempotency`
  index `{ businessId, idempotencyKey }` treats missing keys as `null`, so
  two key-less bookings in one business collide (E11000). Phase 04 must
  always generate keys, or the index needs `partialFilterExpression`.

## 7. Tests (actual commands and results)

| Command | Result |
|---|---|
| `node --test apps/server/test/availability-exceptions.test.js` | **11/11 pass** (after fix: synthetic bookings needed distinct idempotencyKeys due to the unique index) |
| `npm test` (root) | **90/90 pass** (79 previous + 11 new) |
| `npm run lint` | 0 errors, 0 warnings |
| **E2E over real HTTP** (`node src/server.js` + `phase03-inc02-exceptions.mjs`) | **PASS, 17 assertions**: owner register→verify→login → business → staff → synthetic confirmed booking inserted via Mongo → staff-scoped closure → **conflict=1, booking untouched** → PATCH to override covering the booking → **conflicts=0** → filtered list=1 → delete → list=0 → cross-tenant POST → 403. |
| E2E incident | First two runs failed at the filtered-list step: the server process was still running pre-fix code (staffId stored as string). Restarted the server and re-ran — root cause was stale process, not logic. |

## 8. Known Limitations

- `serviceId`-scoped blocks are persistable now but have no behavioral effect
  until the slot engine consumes them (increment 03).
- Conflict scan loads all active bookings of the tenants (businessId+status
  index) rather than a segment-overlap index; fine at current scale, revisit
  with Phase 04's booking index design.
- No audit event is emitted for exception CRUD (parity with Phase 02 CRUD).

## 9. Git Commit

*(hash recorded after commit)*

## 10. Next Increment

**Phase 03 — increment 03:** the slot engine — composition of business open
intervals ∩ staff work intervals, generation of candidate slot starts at
`defaultSlotIntervalMinutes`, filtering by `minNoticeHours`, `maxHorizonDays`,
service duration + buffers, staff eligibility/qualifications, and (once
Phase 04 data exists) existing active bookings; exposed as a public read
endpoint on the directory profile (allowlisted, no private data).
