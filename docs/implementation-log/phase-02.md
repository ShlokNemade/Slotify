# Phase 02 — Business Setup & Directory

**Document:** `docs/implementation-log/phase-02.md`  
**Status:** Completed & Verified  
**Date:** 2026-10-17  

---

## 1. Scope Delivered

- **Increment 01 (Password Reset - `baa0772`):** Non-enumerating reset request, single-use token verification, session revocation on reset.
- **Increment 02 (Owner Business CRUD - `0cc0878`):** Create draft business, view/update details, unique slug enforcement, per-day schedule merge.
- **Increment 03 (Services & Staff CRUD - `ef631f9`):** Tenant-scoped CRUD, `eligibleStaffIds` cross-tenant validation, buffer placement (`before`, `after`, `between`), soft deactivation.
- **Increment 04 (Admin Review & Bootstrap - `55278a7`):** Idempotent admin CLI (`npm run bootstrap:admin`), listing businesses by status, approve/reject endpoints, owner submission lifecycle (`draft`/`rejected` -> `pending_approval` -> `approved`).
- **Increment 05 (Public Directory & Profile - `b03698d`):** Filtered listing (category, city, country, price, search query), pagination, public profile by slug. Approved + >=1 active service required for directory exposure.

## 2. API Surface Delivered

| Area | Method | Path | Auth / Guard | Description |
|---|---|---|---|---|
| Auth | `POST` | `/api/v1/auth/request-password-reset` | None | Non-enumerating token generation |
| Auth | `POST` | `/api/v1/auth/reset-password` | None | Reset password, revoke active sessions |
| Owner | `POST` | `/api/v1/businesses` | Verified Owner | Create draft business profile |
| Owner | `GET`, `PATCH` | `/api/v1/businesses/:businessId` | Business Owner | Read or patch profile and operating hours |
| Owner | `POST` | `/api/v1/businesses/:businessId/submit` | Business Owner | Submit profile for admin review |
| Owner | `CRUD` | `/api/v1/businesses/:businessId/services[/:serviceId]` | Business Owner | Manage tenant services (soft delete) |
| Owner | `CRUD` | `/api/v1/businesses/:businessId/staff[/:staffId]` | Business Owner | Manage tenant staff and shifts (soft delete) |
| Admin | `GET` | `/api/v1/admin/businesses` | Admin | Filter businesses by approval status |
| Admin | `POST` | `/api/v1/admin/businesses/:businessId/review` | Admin | Approve or reject business with notes |
| Public | `GET` | `/api/v1/directory/businesses` | Public | Paginated search of approved businesses |
| Public | `GET` | `/api/v1/directory/businesses/:slug` | Public | View public business details and services |

## 3. Key Invariants & Decisions

1. **Owner Eligibility:** Verified owner email required to create and manage businesses.
2. **Publication Guard:** Business must be `approved` and contain >=1 active service to appear publicly.
3. **Soft Deactivation:** Services and staff records are deactivated (`isActive: false`), never hard-deleted, to preserve booking audit references.
4. **Outbox Events:** Emits `business.approved`, `business.rejected`, and `user.password_reset_requested`.

## 4. Verification Evidence

- `npm test`: **52 integration tests passing** against MongoDB replica set `rs0`.
- `npm run lint`: 0 errors, 0 warnings.
- HTTP E2E: Tested complete flow (register -> verify -> login -> create business -> submit -> admin review -> public directory).

