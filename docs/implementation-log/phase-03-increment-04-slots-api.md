# Phase 03 — Increment 04: Availability HTTP Surfaces & Phase Completion

**Document:** `docs/implementation-log/phase-03-increment-04-slots-api.md`
**Status:** Completed & Verified
**Date:** 2026-10-30

---

## 1. Objective

Expose the slot engine: an owner availability preview (internal per-staff
breakdown) and a public bookable-slots endpoint on the directory (merged
"any available" view) — completing the Phase 03 acceptance surface.

## 2. Requirements Addressed

- `docs/requirements.md` (Directory): public profile shows "...bookable
  slots"; (Availability): candidate generation/server-side checks.
- `docs/security.md`: public pages must not expose private schedules —
  the public endpoint returns slot instants only; weekly shift templates,
  breaks, leave and abuse data remain private.
- Invariant #9 (cross-tenant rejected) and existence-privacy consistency
  with the directory profile (draft/pending/rejected → 404).

## 3. Files Changed

| File | Purpose |
|---|---|
| `apps/server/src/services/availability/slot-engine.js` | pure engine (increment 03) — unchanged here |
| `apps/server/src/services/availability/availability-service.js` | **New** — wires DB (staff, services, exceptions, active bookings) into the engine; range normalization (≤14 days, reversed → 400); public slug gate |
| `packages/shared/src/schemas/availability.js` | adds `ownerSlotsQuerySchema` (owner may scope `staffId`) and `publicSlotsQuerySchema` |
| `apps/server/src/routes/availability-routes.js` | **New** — `GET /api/v1/businesses/:businessId/availability` (auth + ownership) |
| `apps/server/src/routes/directory-routes.js` | adds `GET /api/v1/directory/businesses/:slug/slots` (public, approved-gated) |
| `apps/server/src/app.js` | mounts the availability router |
| `apps/server/test/availability-slots.test.js` | **New** — 7 integration tests |

## 4. Implementation

- **Owner preview** (`GET .../availability?serviceId&fromDate&toDate&staffId`):
  per-staff slot lists + merged any-staff view; `staffId` scopes to one
  member. Cross-tenant access → 403 (middleware); unknown service → 404.
- **Public slots** (`GET /directory/businesses/:slug/slots?serviceId...`):
  approved + ≥1-active-service gate (same 404 semantics as the profile, no
  existence leak); response = `{ timeZone, serviceId, slotIntervalMinutes,
  range, anyStaffSlots }`. Public shape stays merged by design: it reveals
  *bookable instants*, never who works which recurring hours.
- **Booking wiring:** active bookings (`pending` + `confirmed`) are loaded
  and their segments flatten into `bookedSegments` for the engine; the scan
  window spans the requested range minus a 6h margin so pre-range segments
  can still collide with buffered spans of early candidates.
- **Range:** `fromDate` defaults to the current business-local date;
  reversed or >14-day ranges → 400. The engine still applies the
  `maxHorizonDays` clamp internally (defense in depth).

## 5. Concurrency & Correctness Posture

Slots here are **advisory read data**: a customer-visible open slot does not
reserve anything. The Phase 04 booking write path MUST revalidate through
the same engine inputs (not trust the read response) and enforce atomic
staff-interval conflict prevention (transactions + revalidation per
`docs/AGENTS.md` invariants). This is documented in the phase summary as the
contract Phase 04 must honor.

## 6. Tests (actual commands and results)

| Command | Result |
|---|---|
| `node --test apps/server/test/availability-slots.test.js` | **7/7 pass** (weekend notice-floor bug found in my fixture dates, not the code: March was in the past → notice floor removed every candidate; fixtures moved to the next real Monday) |
| `node --test apps/server/test/availability-slot-engine.test.js` | 17/17 |
| `npm test` (root) | **114/114 pass** |
| `npm run lint` | 0 errors, 0 warnings |
| **E2E over real HTTP** (`phase03-inc04-slots.mjs`, real server + Mongo) | **PASS, 24 assertions** in two scenarios: (1) owner setup → approval → owner preview shows 14 slots (30-min grid × AFTER buffer), public slot response contains no shift/leave data; (2) synthetic confirmed booking for Anna 10:00–11:00 → Anna drops to 10 starts (buffered span eats 09:00–10:30 starts), Ben keeps 14, public any-staff still 14; then a full-day instant closure → zero slots for everyone AND the booking is **still confirmed** (never auto-cancelled). |

## 7. API Surface After Phase 03

```
Owner:    GET /api/v1/businesses/:businessId/availability?serviceId&fromDate&toDate&staffId
          POST/GET/PATCH/DELETE /api/v1/businesses/:businessId/exceptions[/:id]
Public:   GET /api/v1/directory/businesses/:slug/slots?serviceId&fromDate&toDate
```

## 8. Known Limitations

- Public endpoint exposes per-staff slot lists only to owners; customers use
  the merged any-staff list until the Phase 04 booking flow needs per-staff
  selection (then: instants only, never templates).
- Booking scan queries the whole tenant's active bookings (indexes exist for
  businessId+status+startTime); segment-level overlap refinement belongs to
  the Phase 04 design with bookings own indexes.
- No caching/ETags on public slots (Phase 8 polish).

## 9. Git Commit

`feat(availability): add pure slot engine and availability slots API` — `90cd3d3`

## 10. Next Phase

**Phase 04 — Booking integrity/lifecycle** per `docs/implementation-phases.md`.
