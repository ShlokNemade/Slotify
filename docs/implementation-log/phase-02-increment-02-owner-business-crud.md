# Phase 02 — Increment 02: Owner Business CRUD

**Document:** `docs/implementation-log/phase-02-increment-02-owner-business-crud.md`
**Status:** Completed & Verified
**Date:** 2026-10-17

---

## 1. Objective

Owner onboarding core: an email-verified owner can create a draft business, read it, and update its profile, slug, hours, and booking policy — the "owner onboarding/approval, profiles/slugs, … hours" slice of Phase 02 (`docs/implementation-phases.md` phase 2).

## 2. Requirements Addressed

- `docs/requirements.md`: owner self-registration flow; "Owners can edit a unique slug"; business profile/location/time zone/hours; booking horizon & notice defaults.
- `docs/data-api.md`: `Business` entity (owner, slug, approval status, profile, location, time zone, hours, booking horizon); unique active business slug.
- Acceptance criterion #2 groundwork: draft businesses are not public (publication gating arrives with the directory in increment 05).
- Invariant: tenant isolation on every owner route.

## 3. Files Changed

| File | Change |
|---|---|
| `apps/server/src/services/business-service.js` | **New** — `createBusiness`, `getBusinessById`, `updateBusiness`, `toBusinessResponse` |
| `apps/server/src/routes/business-routes.js` | **New** — `POST /`, `GET /:businessId`, `PATCH /:businessId` |
| `apps/server/src/app.js` | Mounts `businessRouter` at `/api/v1/businesses` |
| `apps/server/test/business.test.js` | **New** — 12 integration tests |
| `docs/implementation-log/phase-02-increment-02-owner-business-crud.md` | This log |

## 4. Implementation

- **`createBusiness`** builds the stored document from the `createBusinessSchema`-validated payload: `ownerId`, `status: 'draft'` (`BusinessStatus.DRAFT`), default closed-all-week `hours`, null review fields, timestamps. On insert, a duplicate-key error (`code 11000` from the `uniq_business_slug` index) is converted to a friendly 409 — the race backstop for slug claims between the check-then-insert window. (Unlike `registerUser`, which still relies on a pre-check for the same race — see audit §5.4 — here the index catch is the primary defense for updates and the backstop for creation.)
- **`getBusinessById`** validates the id shape, returns the raw stored document, or `NotFoundError`.
- **`updateBusiness`** applies a `updateBusinessSchema`-validated partial patch via `$set`. `hours` receives special handling: the Zod `z.record(dayOfWeek, …)` parse yields only the *provided* days, so the service **merges** the patch's days with the stored hours before `$set` — otherwise `$set: { hours }` would replace the whole object and silently wipe all unmentioned days.
- **`toBusinessResponse`** is the owner-facing projection: includes internal-but-owner-visible fields (`status`, `reviewNotes`, `reviewedAt`) and excludes nothing sensitive (owner already owns it). Public projection (allowlist) comes in increment 05.
- **Routes** compose existing guards: `authenticate → requireRole(owner) → requireVerifiedEmail` for creation; `authenticate → requireBusinessOwnership` for get/update. `requireBusinessOwnership` attaches `req.business` for owners; platform admins bypass without attachment, so the GET route fetches via `getBusinessById` when `req.business` is absent (admin case), avoiding an undefined dereference.

## 5. Design Rationale

- **Verified email required to create a business** (not just to publish): onboarding follows verification in the requirements narrative ("email verification and platform-admin approval before publication" describes publication, but the guided-setup flow presupposes a verified account). Low risk: creation is free and non-public.
- **Hours merge instead of replace:** prevents a partial-day PATCH from destroying the rest of the week. The alternative (require full hours object on every PATCH) is worse UX and more error-prone for clients.
- **Duplicate-slug → 409 ConflictError** matches the register duplicate-email behavior.
- Old-slug redirects/reuse (open question #9) intentionally deferred — no slug-history table yet; documented below as a limitation.

## 6. Architecture & Data Flow

```
POST /api/v1/businesses            authenticate → role=owner → verified email → Zod → insert (draft) → 201
GET  /api/v1/businesses/:id        authenticate → requireBusinessOwnership (owner match | admin) → 200
PATCH /api/v1/businesses/:id       authenticate → requireBusinessOwnership → Zod partial → merge hours → $set → 200
```

Data: `businesses` collection, unique index `uniq_business_slug`, `idx_business_owner`. No new collections.

## 7. API and Data Changes

- **New endpoints:** `POST /api/v1/businesses`, `GET /api/v1/businesses/:businessId`, `PATCH /api/v1/businesses/:businessId`.
- **Business document shape (as stored):** `name, slug, description, category, status ('draft'|'pending_approval'|'approved'|'rejected'), timeZone, location {address, city, state?, postalCode?, country, latitude?, longitude?}, hours {day: {isOpen, windows[]}}, defaultSlotIntervalMinutes, minNoticeHours, maxHorizonDays, ownerId, reviewNotes, reviewedAt, createdAt, updatedAt`.
- Admin review fields (`reviewNotes`, `reviewedAt`) are reserved but only written by admin routes (increment 04).

## 8. Security & Failure Handling

- Server-side Zod validation of body on create/update; slug/format/length/ranges enforced by shared schemas (never trusted from client).
- Authorization: role + verified-email + business-ownership guards; cross-tenant GET/PATCH → 403 with standard envelope.
- Slug uniqueness enforced by the DB index (correctness does not depend on the pre-check); duplicate insert/update → 409.
- Invalid `:businessId` (non-ObjectId) → 404, not a 500.
- No unvalidated mass assignment: only schema-validated fields reach `$set`; `status`/`reviewNotes`/`ownerId` are **not** settable via PATCH (`updateBusinessSchema` does not include them).

## 9. Tests (actual commands and results)

| Command | Result |
|---|---|
| `npm test --workspace=@slotify/server` | **30/30 pass** — 18 pre-existing + 12 new business tests. Two failures during development were fixed: (a) hours were replaced wholesale by `$set` — fixed by merging with stored hours in the service; (b) test bug — string id used in a direct Mongo query instead of `ObjectId`. |
| `npm run lint` (root) | 0 errors, 0 warnings |
| **E2E (mandatory):** real server process, full owner-onboarding flow over HTTP | **PASS** — 1. register owner → 2. verify email → 3. login → 4. `POST /businesses` → 201 draft with default closed hours → 5. `PATCH` description+Monday hours → description saved, Monday open, other days intact (merge verified) → 6. owner `GET` re-read confirms persistence → 7. second verified owner's `GET` of the same business → **403 `FORBIDDEN` "Access denied: You do not own this business"** with correlation ID. |

## 10. Configuration

None added. No new dependencies. No new env vars.

## 11. Known Limitations

- **No slug history/redirects** (open question #9): changing a slug invalidates the old public URL with no redirect; slug reuse by another business becomes possible only after the record is deleted (no soft-delete exists yet).
- A platform admin can currently read any business via the owner GET route (by design of the tenant guard) — a dedicated admin route group arrives in increment 04.
- No pagination/limits on businesses-per-owner (one owner = one business is implied by requirements but not yet enforced).

## 12. Debugging Guide

- **409 on create/update with a slug that looks free:** another business holds it — query `db.businesses.find({slug})`.
- **Hours day "disappeared" after PATCH:** should not happen anymore (merge logic); if it does, check `updateBusiness` merge branch and the Zod record parse output.
- **403 on owner GET with valid token:** session belongs to a different owner — check `businesses.ownerId` vs `user.id`.

## 13. Git Commit

`feat(business): add owner business create, read, and update with slug uniqueness` (hash recorded after commit).

## 14. Next Increment

**Increment 03 — Services & staff CRUD:** owner-scoped `services` and `staff` collections using `createServiceSchema`/`updateServiceSchema` and the staff schema, tenant-guarded routes under `/api/v1/businesses/:businessId/services|staff`, `eligibleStaffIds` cross-checks, and indexes (already initialized in `db/mongo.js`).
