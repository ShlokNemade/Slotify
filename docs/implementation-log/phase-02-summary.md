# Phase 02 — Completion Summary: Business Setup & Directory

**Document:** `docs/implementation-log/phase-02-summary.md`
**Status:** Completed & Verified
**Date:** 2026-10-17
**Engineer:** OpenCode (GLM-5.3-Flash), continuing from Antigravity's Phase 01

---

## 1. Scope Delivered

Phase 02 per `docs/implementation-phases.md`: **"Business setup and directory: owner onboarding/approval, profiles/slugs, services/staff/hours, public directory/profile."**

All of it implemented as backend API slices on the Phase 01 Express foundation (the React client does not exist yet; see interpretation note in `phase-01-handoff-audit.md` §8).

| Increment | Deliverable | Log | Commit |
|---|---|---|---|
| 01 | Password reset (Phase 01 scope completion): non-enumerating request + single-use complete + session revocation | `phase-02-increment-01-password-reset.md` | `baa0772` |
| 02 | Owner business CRUD: create draft / read / update, slug uniqueness, hours merge | `phase-02-increment-02-owner-business-crud.md` | `0cc0878` |
| 03 | Services & staff CRUD: tenant-scoped, staff-membership validation, soft deactivation | `phase-02-increment-03-services-staff-crud.md` | `ef631f9` |
| 04 | Admin review & bootstrap: idempotent admin CLI, status listing, approve/reject with audit + outbox, owner submit/resubmit lifecycle | `phase-02-increment-04-admin-review-bootstrap.md` | `55278a7` |
| 05 | Public directory & profile: allowlisted, approval-gated, filtered, paginated | `phase-02-increment-05-public-directory.md` | (this commit) |

Also created before the increments: `phase-01-handoff-audit.md` (commit `c17867d`), which documents the working-tree restoration incident and Phase 01 verification.

## 2. Verification State at Phase End

- **Unit/integration:** 11 shared schema tests + **52 server integration tests, all passing** against the live `rs0` replica set (`npm test`).
- **Lint:** 0 errors, 0 warnings (`npm run lint`).
- **E2E:** every increment was exercised over HTTP against the real server process (`node src/server.js`), covering the full lifecycle: register → verify → login → create business → submit → admin review → public directory visibility. All E2E runs passed; one environment-state incident (wiped admin) is documented in the increment 05 log.
- **No E2E browser (Playwright) layer exists yet** — the documented E2E for Phases 0–2 is HTTP-level; browser E2E becomes meaningful once a client exists.

## 3. Public API Surface After Phase 02

```
Auth:        POST /api/v1/auth/register | login | logout | me | verify-email
             POST /api/v1/auth/request-password-reset | reset-password
Owner:       POST /api/v1/businesses
             GET/PATCH /api/v1/businesses/:businessId
             POST /api/v1/businesses/:businessId/submit
             CRUD /api/v1/businesses/:businessId/services[/:serviceId]
             CRUD /api/v1/businesses/:businessId/staff[/:staffId]
Admin:       GET /api/v1/admin/businesses?status=&page=&limit=
             POST /api/v1/admin/businesses/:businessId/review
Public:      GET /api/v1/directory/businesses?category&city&country&search&minPrice&maxPrice&page&limit
             GET /api/v1/directory/businesses/:slug
Operational: GET /health, GET /ready
```

## 4. Key Decisions Made in Phase 02 (documented trade-offs)

1. **Phase 02 = backend API slices** (following the Phase 01 log's own recommendation); client development deferred.
2. **Verified owner email required to create a business** (not just to publish).
3. **Completeness rule for publication:** approved + ≥1 active service.
4. **Hours PATCH merges per-day** instead of replacing the week.
5. **Soft deactivation for services/staff** (no hard deletes; booking history must survive).
6. **Cross-tenant staff references rejected server-side** (`eligibleStaffIds` membership check).
7. **Resubmission default (open question #12):** any owner edit to a rejected business resubmits it; explicit submit route also provided.
8. **New outbox events:** `business.approved`, `business.rejected` (consumed by Phase 5 workers).
9. **Slug history/redirects (open question #9):** still open; no reuse/redirect tracking implemented.

## 5. Outstanding Items / Handoff to Phase 03

- **Phase 03 — Availability engine** is the next phase: recurring hours + exceptions + staff shifts/breaks/leave expansion, qualifications matching, durations/buffers, notice/horizon, DST handling. The data created in Phase 02 (business hours, staff shifts, services with buffers/eligibility) is exactly its input.
- Register endpoint race (audit §5.4) and non-transactional outbox writes (audit §5.5) remain minor known issues.
- No rate limiting yet (Phase 6); no notifications delivery yet (Phase 5 — outbox rows accumulate as `pending`).
- One owner may currently create multiple businesses (requirements imply one); not enforced yet.
- Browser E2E (Playwright) and the React client remain future work.

## 6. Git

Local commits only; **no push was performed at any point** (verified: no push commands executed; remote untouched).
