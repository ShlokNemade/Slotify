# Phase 03 — Availability Engine & Slots API

**Document:** `docs/implementation-log/phase-03.md`  
**Status:** Completed & Verified  
**Date:** 2026-10-30  

---

## 1. Scope Delivered

- **Increment 01 (Schedule Expansion - `17c173c`):** Pure UTC half-open interval math (`[start, end)`). DST transition logic using `date-fns-tz`: nonexistent wall times roll forward; ambiguous times pick the first occurrence.
- **Increment 02 (Availability Exceptions - `a74837b`):** Persistence for `availability_exceptions` collection. Tenant-scoped CRUD at `/api/v1/businesses/:businessId/exceptions`. Advisory conflict detection returning existing conflicting booking warnings without mutating bookings.
- **Increment 03 (Pure Slot Engine - `90cd3d3`):** `slot-engine.js`: interval grid anchored at local midnight; service duration and buffer constraints (`before`, `after`, `between`); staff eligibility matching (`requiredQualifications` + `eligibleStaffIds`); staff shift intervals; notice and horizon bounds; merged any-staff deduplication.
- **Increment 04 (Availability HTTP Surfaces - `90cd3d3`):** Owner slot preview (`GET /api/v1/businesses/:businessId/availability`) with per-staff breakdown; public bookable slots (`GET /api/v1/directory/businesses/:slug/slots`) gated by business approval and complete profile.

## 2. API Surface Delivered

| Area | Method | Path | Auth / Guard | Description |
|---|---|---|---|---|
| Exceptions | `POST` | `/api/v1/businesses/:businessId/exceptions` | Business Owner | Create schedule block/closure; returns advisory conflicts |
| Exceptions | `GET` | `/api/v1/businesses/:businessId/exceptions` | Business Owner | List active schedule exceptions |
| Exceptions | `DELETE` | `/api/v1/businesses/:businessId/exceptions/:exceptionId` | Business Owner | Remove an exception |
| Owner | `GET` | `/api/v1/businesses/:businessId/availability` | Business Owner | Calculate slots with per-staff assignments |
| Public | `GET` | `/api/v1/directory/businesses/:slug/slots` | Public | Return merged bookable start times |

## 3. Key Invariants & Rules

1. **Advisory Reads:** Generated slots are advisory reads. The booking write path must independently re-validate availability and enforce atomic assignment inside a database transaction.
2. **Non-destructive Blocks:** Adding an exception/closure never cancels or alters confirmed bookings (Invariant 5).
3. **Interval Representation:** All temporal calculations operate on half-open UTC intervals `[start, end)` in milliseconds.
4. **Buffer Alignment:** `before` buffer blocks `[start - buffer, start + duration)`; `after` buffer blocks `[start, start + duration + buffer)`.

## 4. Verification Evidence

- `npm test`: **114/114 tests passing** (27 expansion core unit, 11 exception CRUD integration, 17 slot-engine unit, 7 slot HTTP endpoint, 52 pre-existing).
- `npm run lint`: 0 errors, 0 warnings.
- HTTP E2E: Verified exception creation with warning payloads, slot generation for approved businesses, 404 for draft businesses, and strict data masking (zero staff shifts/private bookings in public slots response).

