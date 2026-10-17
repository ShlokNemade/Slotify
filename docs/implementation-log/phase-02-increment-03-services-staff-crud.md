# Phase 02 — Increment 03: Services & Staff CRUD

**Document:** `docs/implementation-log/phase-02-increment-03-services-staff-crud.md`
**Status:** Completed & Verified
**Date:** 2026-10-17

---

## 1. Objective

Owner catalog management: services and staff records, strictly scoped to the owner's business — the "services/staff" slice of Phase 02 (`docs/implementation-phases.md` phase 2).

## 2. Requirements Addressed

- `docs/requirements.md`: owners "manage … services, staff records"; staff are owner-managed with no login; per-service buffers with placement; eligible staff.
- `docs/data-api.md`: `Service` (duration, displayed price, eligible staff, buffer duration/placement, active state) and `Staff` (display name, qualifications, shifts, breaks, leave; no login) entities.
- Invariant: tenant isolation — every catalog record carries `businessId` and every route is ownership-guarded.
- `docs/data-api.md`: "Never trust client-provided … staff eligibility" — enforced by server-side staff-membership validation.

## 3. Files Changed

| File | Change |
|---|---|
| `apps/server/src/services/service-service.js` | **New** — service CRUD + staff-membership validation + response projection |
| `apps/server/src/services/staff-service.js` | **New** — staff CRUD + response projection |
| `apps/server/src/routes/service-routes.js` | **New** — 5 routes under `/api/v1/businesses/:businessId/services` |
| `apps/server/src/routes/staff-routes.js` | **New** — 5 routes under `/api/v1/businesses/:businessId/staff` |
| `apps/server/src/app.js` | Mounts both routers with `:businessId` param |
| `apps/server/test/catalog.test.js` | **New** — 9 integration tests |
| `docs/implementation-log/phase-02-increment-03-services-staff-crud.md` | This log |

## 4. Implementation

- **Tenant scoping:** both routers are mounted at `/api/v1/businesses/:businessId/…` with `{ mergeParams: true }` so `requireBusinessOwnership` can read `req.params.businessId`. A `router.use(authenticate, requireBusinessOwnership)` guard applies to every route in both routers — ownership is checked once, not per-handler.
- **Staff-membership validation (`assertStaffBelongToBusiness`):** when a service is created or updated with `eligibleStaffIds`, the service counts matching staff documents with `{ _id: $in ids, businessId }` and rejects with `VALIDATION_ERROR` unless every id matches. This prevents an owner from referencing another tenant's staff (which would otherwise silently corrupt later availability logic) and also catches nonexistent ids.
- **Soft deactivation:** `DELETE /services/:id` and `DELETE /staff/:id` set `active: false` instead of hard-deleting — bookings will snapshot/reference these records (data-api recommends snapshotting at booking time), so history must survive. `PATCH` with `active: true` reactivates.
- **Owner-view listing** includes inactive records (owner manages the full catalog); the public profile projection (increment 05) filters to active only.
- **Response projections** (`toServiceResponse`, `toStaffResponse`) map ObjectIds to strings and exclude nothing owner-sensitive (no secrets exist on these records).

## 5. Design Rationale

- **Separate routers with mergeParams** follow the Express standard for nested resources and keep each resource independently mountable/testable.
- **`countDocuments` membership check** rather than fetching documents: one query, no data transfer; concurrent staff deletion between check and service write is not a correctness risk here because `eligibleStaffIds` are only advisory for availability (Phase 3) and are snapshot-checked again at booking time (Phase 4).
- **No hard delete anywhere in the catalog** — consistent with the append-only/preserve-history principle in `docs/data-api.md` and booking snapshots.
- Alternative rejected for DELETE: refuse deletion if bookings exist — deferred until bookings exist (Phase 4); soft-delete is already the safe superset.

## 6. Architecture & Data Flow

```
POST   /api/v1/businesses/:businessId/services   auth → ownership → Zod → staff-membership check → insert
GET    /api/v1/businesses/:businessId/services   auth → ownership → find all (sorted by name)
GET    …/services/:serviceId                     auth → ownership → findOne (scoped by businessId)
PATCH  …/services/:serviceId                     auth → ownership → Zod partial → staff check → $set
DELETE …/services/:serviceId                     auth → ownership → $set active=false
(same shape for /staff)
```

Data: `services` and `staff` collections; indexes `idx_services_business_active`, `idx_staff_business_active` (already created in `db/mongo.js`).

## 7. API and Data Changes

- **New endpoints (10):** CRUD on `/api/v1/businesses/:businessId/services` and `/staff`.
- **Service document:** `name, description, durationMinutes (5–480), bufferMinutes (0–120), bufferPlacement ('before'|'after'|'between'), price?, active, eligibleStaffIds[], businessId, timestamps`.
- **Staff document:** `displayName, email?, qualifications[], active, shifts[] (day + windows), breaks[] (day, start, end, reason?), leave[] (startDate, endDate, reason?), businessId, timestamps`.
- No changes to existing endpoints. Public projections are deliberately deferred to increment 05.

## 8. Security & Failure Handling

- Ownership guard on every route (403 cross-tenant, 404 unknown business, 401 unauthenticated).
- Server-side staff-membership validation (cross-tenant staff references → 400).
- Zod validation on all writes; invalid enum days / ranges → 400.
- Records of other tenants return 404 (not 403) when addressed directly under the wrong business — avoids leaking existence across tenants.
- Soft delete preserves referential history; no destructive operations.

## 9. Tests (actual commands and results)

| Command | Result |
|---|---|
| `npm test --workspace=@slotify/server` | **39/39 pass** — 30 pre-existing + 9 new catalog tests (service defaults, cross-tenant 403, foreign-staff rejection, list/update/deactivate, wrong-business 404, staff defaults, invalid shift 400). First run: all passed except none — no fixes required for this suite. |
| `npm run lint` (root) | 0 errors, 0 warnings |
| **E2E (mandatory):** real server process, full catalog flow over HTTP | **PASS** — 1. register+verify+login owner → 2. create business → 3. create staff (Anna, defaults) → 4. create service with `eligibleStaffIds=[staffId]` → accepted, eligible list echoed back → 5. list both (1 service, 1 staff) → 6. create service with a nonexistent staff id → **HTTP 400 `VALIDATION_ERROR` "eligibleStaffIds contains staff that do not belong to this business"** (verified error envelope with correlation ID) → 7. `DELETE` service → `active: false` (soft delete confirmed). |

## 10. Configuration

None added. No new dependencies. No new env vars.

## 11. Known Limitations

- Catalog listing is unpaginated (sorted, full list). Pagination via `paginationQuerySchema` can be added when collections grow; deferred to keep the slice small.
- No staff-email uniqueness per business (staff emails are optional contact info, not credentials).
- `eligibleStaffIds` is validated at write time only; deactivating staff does not clean references (availability logic must ignore inactive staff — Phase 3 concern).

## 12. Debugging Guide

- **403 on catalog routes:** token belongs to a different owner — `requireBusinessOwnership` compares `businesses.ownerId`.
- **400 "do not belong to this business":** ids are nonexistent, malformed, or foreign — `db.staff.find({_id: …})`.
- **Service still listed after DELETE:** by design (soft delete, owner view includes inactive); public endpoints filter `active: true`.

## 13. Git Commit

`feat(catalog): add tenant-scoped service and staff CRUD with eligibility validation` (hash recorded after commit).

## 14. Next Increment

**Increment 04 — Admin review & bootstrap:** secure local admin bootstrap script, admin tenant-review endpoints (`GET` pending businesses, `POST` approve/reject using `reviewBusinessSchema`), audit events for approval actions, and resubmission behavior on rejection.
