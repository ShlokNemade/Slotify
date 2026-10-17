# Phase 02 — Increment 04: Admin Review & Bootstrap

**Document:** `docs/implementation-log/phase-02-increment-04-admin-review-bootstrap.md`
**Status:** Completed & Verified
**Date:** 2026-10-17

---

## 1. Objective

Platform-admin tenant review: secure local admin bootstrap, listing businesses by approval status, approve/reject decisions with audit records, and the owner-side submit/resubmit lifecycle — completing the "owner onboarding/approval" slice of Phase 02.

## 2. Requirements Addressed

- `docs/requirements.md`: "email verification and platform-admin approval before publication"; "Platform admin: separate admin area; secure local bootstrap/seed; no public admin registration; tenant approval".
- `docs/security.md`: "Platform-admin permissions are bootstrapped securely, never via public registration or client-controlled fields."
- `docs/data-api.md`: append-only `AuditEvent`; owner cancellations/approvals recorded.
- `docs/open-questions.md` #12 (business approval: rejection reasons, resubmission, re-review) — minimal default implemented and documented.

## 3. Files Changed

| File | Change |
|---|---|
| `packages/shared/src/schemas/outbox.js` | Added `BUSINESS_APPROVED` / `BUSINESS_REJECTED` outbox event types (additive) |
| `packages/shared/src/schemas/business.js` | Added `adminBusinessListQuerySchema` (status filter + pagination) |
| `apps/server/src/services/admin-service.js` | **New** — `bootstrapAdmin`, `listBusinessesByStatus`, `reviewBusiness` |
| `apps/server/src/services/business-service.js` | Added `submitBusinessForReview`; auto-resubmission on owner edit of a rejected business |
| `apps/server/src/routes/admin-routes.js` | **New** — `GET /api/v1/admin/businesses`, `POST /api/v1/admin/businesses/:businessId/review` |
| `apps/server/src/routes/business-routes.js` | Added `POST /api/v1/businesses/:businessId/submit` |
| `apps/server/src/app.js` | Mounts `adminRouter` at `/api/v1/admin` |
| `apps/server/scripts/bootstrap-admin.js` | **New** — env-driven admin bootstrap CLI |
| `apps/server/package.json` | Added `bootstrap:admin` script |
| `.env.example` | Added `ADMIN_EMAIL` / `ADMIN_PASSWORD` placeholders |
| `apps/server/test/admin.test.js` | **New** — 6 integration tests |

## 4. Implementation

- **`bootstrapAdmin`** is an idempotent upsert: creates a `platform_admin` user (verified, active) or, if the email exists, elevates it to platform admin and resets the password from env. The script (`scripts/bootstrap-admin.js`) validates presence and ≥12-char length of `ADMIN_EMAIL`/`ADMIN_PASSWORD` before touching the DB, prints only the userId (never the password), and exits non-zero when inputs are missing. It is a CLI path — not reachable through the API.
- **Admin guard:** `adminRouter.use(authenticate, requireRole(PLATFORM_ADMIN))` covers every admin route; owners/customers get 403, unauthenticated 401.
- **`listBusinessesByStatus`** filters by an allowlisted status enum and paginates (`page`/`limit`, default 20, max 100).
- **`reviewBusiness`** transitions a business to `approved`/`rejected` (schema requires notes for rejection), sets `reviewNotes`/`reviewedAt`, then writes two records: an **append-only audit event** (`action: 'business.approved'|'business.rejected'`, platform scope, actor admin, metadata with previous/new status and notes) and an **outbox event** (`business.approved`/`business.rejected`) so owner notification stays asynchronous for Phase 5 workers.
- **Owner submit lifecycle:** `POST /api/v1/businesses/:businessId/submit` transitions `draft → pending_approval` (or `rejected → pending_approval`); submitting from any other status is a 400. Additionally, any owner profile edit (`PATCH`) on a **rejected** business automatically resubmits it (`pending_approval`) — the minimal documented default for open question #12. Draft stays draft on edit; approved stays approved.

## 5. Design Rationale

- **Idempotent bootstrap upsert** makes re-running the script safe (e.g., password rotation) without creating duplicate admins; the unique email index is the correctness backstop.
- **Audit + outbox on every review decision** matches the established patterns: audit for accountability (security doc requires tenant approval records), outbox so the HTTP path never waits on notification delivery.
- **Auto-resubmission on edit** was chosen over a separate "resubmit" verb because any meaningful edit to a rejected business is already an implicit resubmission request; the explicit submit route still exists for no-edit resubmission. Alternative rejected: silently keeping rejected businesses rejected after edits (owners would have no feedback loop).
- **Status transitions enforced server-side** (`draft`/`rejected` → `pending_approval` only) — the admin route is the *only* path to `approved`/`rejected`; owners can never self-approve.

## 6. Architecture & Data Flow

```
Owner:  POST /api/v1/businesses/:id/submit        auth → ownership → status guard → pending_approval
Admin:  GET  /api/v1/admin/businesses?status=…    auth → platform_admin → paginated list
Admin:  POST /api/v1/admin/businesses/:id/review  auth → platform_admin → Zod → status update
                                                  → audit_events insert (append-only)
                                                  → outbox insert (business.approved|rejected)
```

New data: `audit_events` collection in active use; outbox gains `business.*` events; businesses gain lifecycle transitions. Indexes unchanged (`idx_audit_business_time`, `idx_outbox_processing`).

## 7. API and Data Changes

- **New endpoints:** `POST /api/v1/businesses/:businessId/submit`; `GET /api/v1/admin/businesses`; `POST /api/v1/admin/businesses/:businessId/review`.
- **Shared schema additions:** `adminBusinessListQuerySchema`; `OutboxEventType.BUSINESS_APPROVED`/`BUSINESS_REJECTED`.
- **Business document:** `status`, `reviewNotes`, `reviewedAt` now written by admin review; `reviewedAt` exposed to the owner.

## 8. Security & Failure Handling

- Admin identity never comes from public registration; bootstrap requires env credentials and refuses to run without them.
- Role guard enforced server-side on every admin route (verified: owner token → 403, no token → 401).
- Rejection without notes → 400 (schema refine).
- Unknown/invalid business id in review → 404; unknown status filter → 400.
- Audit events are append-only (no update/delete paths exist).

## 9. Tests (actual commands and results)

| Command | Result |
|---|---|
| `npm test --workspace=@slotify/server` | **45/45 pass** — 39 pre-existing + 6 new admin tests. Failures fixed during development: (a) leftover `directoryStatusQuerySchema` reference broke the whole app import graph (fixed to `adminBusinessListQuerySchema`); (b) missing `ValidationError` import in `business-service.js`; (c) test logic bug — resubmission test asserted an invalid second submit after the PATCH had already resubmitted; restructured to cover both explicit and PATCH-driven resubmission. |
| `npm run lint` (root) | 0 errors, 0 warnings (fixed one unused-import warning in the new test file) |
| `npm run bootstrap:admin` (with env vars set) | **Pass** — "Platform admin created for e2e-admin@slotify.internal (userId: 6ad320dd…)" |
| **E2E (mandatory):** real server process, full approval flow over HTTP | **PASS** — 1. owner registers+verifies+logs in → 2. creates draft business → 3. submits → `pending_approval` → 4. owner token on admin route → **403** → 5. bootstrap-created admin logs in (`platform_admin`) → 6. `GET /admin/businesses?status=pending_approval` lists the business → 7. approve → `approved` + notes persisted → 8. owner re-reads: `approved` → 9. re-review as reject-without-notes → **400** (schema-enforced). |

## 10. Configuration

- **New env vars (script-only, placeholders in `.env.example`):** `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥12 chars). No secrets committed; values only supplied at runtime.
- **New npm script:** `npm run bootstrap:admin` (workspace `@slotify/server`).
- No new dependencies. `dotenv` loads `.env` automatically for the script (config module is imported transitively via `connectMongo`).

## 11. Known Limitations

- Rejected businesses are not hidden from the owner but no owner-facing "rejection reason" notification exists yet (outbox event ready for Phase 5 workers).
- Admin list is paginated but not filterable by search/category yet (can be added with the directory work).
- One email cannot currently be both owner and platform admin via normal registration; bootstrap *elevates* an existing account by design (documented behavior).
- No rate limiting on admin routes (rate limiting is Phase 6).

## 12. Debugging Guide

- **`bootstrap:admin` exits 1:** missing or short (<12 chars) env vars — check `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- **403 on admin routes:** session role is not `platform_admin` — check `users.role`.
- **"cannot be submitted for review":** business is not in `draft`/`rejected` — check `businesses.status`.
- **No audit record after review:** check `audit_events` for `action: business.approved` and `targetId`.

## 13. Git Commit

`feat(admin): add admin bootstrap, tenant review, and owner submit lifecycle` (hash recorded after commit).

## 14. Next Increment

**Increment 05 — Public directory & profile:** public endpoints (`GET /api/v1/directory`, `GET /api/v1/directory/businesses/:slug`) with allowlisted projections, approved+verified+complete gating (active services required), filters (category/city/country/price/search) and pagination via `directoryQuerySchema`, no auth required.
