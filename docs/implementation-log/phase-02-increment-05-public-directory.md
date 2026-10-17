# Phase 02 — Increment 05: Public Directory & Profile

**Document:** `docs/implementation-log/phase-02-increment-05-public-directory.md`
**Status:** Completed & Verified
**Date:** 2026-10-17

---

## 1. Objective

Public discovery surface: a no-authentication directory of bookable businesses and a public profile per business — the "public directory/profile" slice of Phase 02 (`docs/implementation-phases.md` phase 2).

## 2. Requirements Addressed

- `docs/requirements.md` (directory): filter by category/location/service/date/price; only approved, verified, complete businesses publicly listed; public profile shows description, services/prices, staff display names, hours.
- `docs/security.md`: "Public endpoints return allowlisted published data"; never expose private appointments, customer data, internal staff schedules, or abuse signals.
- Acceptance criterion #2: "Unapproved/incomplete businesses are not publicly listed."
- Invariant: "Public pages must not expose private appointments, customer data, internal schedules, or abuse signals."

## 3. Files Changed

| File | Change |
|---|---|
| `apps/server/src/services/directory-service.js` | **New** — `searchDirectory`, `getPublicBusinessBySlug`, allowlist projections |
| `apps/server/src/routes/directory-routes.js` | **New** — `GET /api/v1/directory/businesses`, `GET /api/v1/directory/businesses/:slug` |
| `apps/server/src/app.js` | Mounts `directoryRouter` at `/api/v1/directory` |
| `apps/server/test/directory.test.js` | **New** — 7 integration tests |
| `README.md` | Quick-start corrections (`dev:server`, `bootstrap:admin`, test commands) |
| `docs/implementation-log/phase-02-increment-05-public-directory.md` | This log |

## 4. Implementation

- **Publication gate (`searchDirectory`):** base filter `status: 'approved'`; then a **completeness gate** — the business must own at least one active service (`services.distinct('businessId', { active: true })` intersected into `_id: $in`). Owner email verification is inherently guaranteed because business creation already requires a verified owner (increment 02), so no users-join is needed.
- **Filters:** `category` (case-insensitive exact), `city`/`country` (case-insensitive exact), `search` (case-insensitive regex over name+description, with regex-escaping of user input), `minPrice`/`maxPrice` (intersected against active services' displayed price via `distinct('businessId')`), `page`/`limit` (defaults 1/20, max 50 — from the shared `directoryQuerySchema`).
- **Summary projection** (`toPublicBusinessSummary`): id, name, slug, description, category, city, country, timeZone only. Explicitly excluded: `ownerId`, `status`, `reviewNotes`, `reviewedAt`, full location object, hours, booking policy numbers.
- **Public profile (`getPublicBusinessBySlug`):** 404 unless the slug resolves to an *approved* business with ≥1 active service (draft/pending/rejected/incomplete are indistinguishable from nonexistent — no existence leak). Returns allowlisted profile + public service list (name, description, duration, price) + staff **display names only** (id + displayName; no shifts, breaks, leave, or emails) + weekly hours + booking policy (slot interval, min notice, horizon — needed by the future booking flow and harmless publicly).
- **Sorting:** alphabetical by name as the "relevance" proxy; nearest-first sorting requires location input beyond the current query schema (deferred — see limitations).

## 5. Design Rationale

- **Deny-by-default allowlist projections** instead of `delete`ing fields from a full document: adding a sensitive field to the schema later cannot leak it by accident.
- **404 (not 403) for non-public slugs** avoids confirming a business's existence/approval state to outsiders.
- **Completeness = has active service:** a business with no services cannot be booked, so listing it would produce dead ends. A looser rule (profile fields present) is deferred; documented trade-off.
- Alternative rejected for price filtering: aggregation pipeline with `$lookup` — more powerful but harder to test and index for a first slice; `distinct` + `_id: $in` is transparent and uses existing indexes.

## 6. Architecture & Data Flow

```
GET /api/v1/directory/businesses?category&city&country&search&minPrice&maxPrice&page&limit
  → Zod query validation (directoryQuerySchema)
  → status=approved + completeness gate + optional filters
  → paginated allowlisted summaries

GET /api/v1/directory/businesses/:slug
  → find approved by slug → completeness check → public profile projection
```

Read-only; no auth middleware; no writes; no new collections or indexes (uses `uniq_business_slug`, `idx_services_business_active`).

## 7. API and Data Changes

- **New endpoints (public, unauthenticated):**
  - `GET /api/v1/directory/businesses` → `{ success, data: { businesses[], total, page, limit } }`
  - `GET /api/v1/directory/businesses/:slug` → `{ success, data: { business } }` with services/staff/hours
- **No schema or index changes.** Date filter (bookable on a given date) is intentionally not implemented yet — it requires the Phase 3 availability engine; the query schema field can be added then.

## 8. Security & Failure Handling

- All inputs Zod-validated; `page=0` / `limit>50` → 400.
- User search strings regex-escaped before `RegExp` construction (no ReDoS/injection surface from regex metacharacters).
- Allowlisted projections; internal fields never serialized on public routes.
- Existence privacy: non-public or unknown slugs both return identical 404 `NOT_FOUND` envelope.
- No booking, appointment, customer, or abuse data exists on these endpoints by construction.

## 9. Tests (actual commands and results)

| Command | Result |
|---|---|
| `npm test --workspace=@slotify/server` | **52/52 pass** — 45 pre-existing + 7 new directory tests (allowlist-only fields, incomplete exclusion, all filters, pagination, profile projections, draft/unknown 404, invalid query 400). |
| `npm run lint` (root) | 0 errors, 0 warnings (removed three unused imports flagged during development) |
| **E2E (mandatory):** real server process, full publish flow over HTTP | **PASS** — 1. owner registers+verifies+logs in → 2. creates business + staff + service → submits → **directory total=0 (pending not public)** → 3. bootstrap-created admin approves → 4. `GET /directory/businesses?category=spa&maxPrice=50` → total=1, slug/city present, **`ownerId` and `status` absent** → 5. `GET /directory/businesses/e2e-dir-spa` → 1 service (price 40), 1 staff (displayName only, **shifts not exposed**) → 6. unknown slug → **404 NOT_FOUND** envelope. |

**E2E incident (documented for honesty):** the first E2E attempt showed `total=0` after "approval" — the admin account had been wiped by the integration test run (test suites clean the `users` collection), so the review call had silently failed. Root cause was environment state, not product code; re-running `npm run bootstrap:admin` and the review completed the flow. This confirms the publication gate fails **closed** (an unapproved business stays invisible).

## 10. Configuration

None added. No new dependencies. No new env vars.

## 11. Known Limitations

- No date-based filter ("available on date X") — requires the Phase 3 availability engine.
- No nearest-first geo sorting — needs a location input (device location is a client concern) and a geo index; the schema has lat/lon fields ready.
- "Relevance" sort is alphabetical name; no ranking signals yet.
- No caching/ETags on public reads (Phase 8 performance polish).

## 12. Debugging Guide

- **Business missing from directory:** check status is `approved` (`db.businesses.find({slug})`), it has ≥1 `active: true` service, and the filter values match exactly (case-insensitive) — especially city/country spelling.
- **404 on a real slug:** business not approved or has no active services (deliberate no-existence-leak).
- **Unexpected 400:** query param out of range (`page < 1`, `limit > 50`, negative price).

## 13. Git Commit

`feat(directory): add public directory search and business profile with publication gating` (hash recorded after commit).

## 14. Next Increment

Phase 02 is complete (all five increments). Next phase per `docs/implementation-phases.md` is **Phase 03 — Availability engine** (recurring hours, exceptions, shifts/breaks/leave, qualifications, durations/buffers, notice/horizon, DST handling). Not started in this session.
