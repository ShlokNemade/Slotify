# Session Handoff — Slotify

**Last updated:** 2026-10-30 (UTC)
**Branch:** `main` · working tree clean at latest documented commit
**Primary detailed source:** `docs/implementation-log/` (per-phase + per-increment logs)

---

## 1. Current Phase

**Phase 03 — Availability engine: COMPLETE and verified** (summary:
`docs/implementation-log/phase-03-summary.md`).
**Next: Phase 04 — Booking integrity/lifecycle** (guided flow, atomic
multi-service booking, concurrency-safe assignment, cancel/reschedule/
proposals, audit/no-show/completion) — NOT started.

## 2. Completed & Verified (do not redo)

- Phases 00–02: domain/security foundations, auth (incl. password reset),
  owner business CRUD, services/staff CRUD, admin review/bootstrap, public
  directory/profile. All E2E-verified over HTTP (see logs).
- **Phase 03 increments (all verified, local commits only):**
  1. `17c173c` — DST-correct schedule expansion core + interval math (27 unit tests).
     DST policy: nonexistent wall times roll forward; ambiguous take first occurrence.
  2. `a74837b` — availability exceptions (`availability_exceptions` collection,
     tenant-scoped owner CRUD at `/api/v1/businesses/:businessId/exceptions`)
     with booking-conflict WARNINGS that never mutate bookings (11 tests + 17-step E2E).
  3. Pure slot engine (`apps/server/src/services/availability/slot-engine.js`):
     grid at `defaultSlotIntervalMinutes` anchored at local midnight; buffered
     span must fit fully; `OCCUPYING_BOOKING_STATUSES = ['pending','confirmed']`;
     `selectEligibleStaff` (active + eligibleStaffIds + requiredQualifications);
     `mergeAnyStaffSlots`; horizon/notice clamps (17 unit tests).
  4. Availability HTTP surfaces: owner `GET .../availability` (per-staff) and
     public `GET /directory/businesses/:slug/slots` (merged any-staff, approved-gated).
     7 integration tests + 24-step E2E (booking conflict scoping, closure vs
     booking survival, no shift-template leak, draft 404).
  - Docs commits: `61e8627`, `0582813`, plus phase-03 summary + increments 03/04 logs.

## 3. Verification Baseline (as of Phase 03 completion)

- `npm test` (root): **114/114 pass** against live `rs0` replica set.
- `npm run lint`: clean.
- E2E method: real `node apps/server/src/server.js` + throwaway `.mjs` scripts
  (kept in `%TEMP%\opencode\slotify-e2e\`, NOT in repo). HTTP-level only; no
  Playwright/client exists yet.

## 4. Binding Design Rules Established in Phase 03 (enforce in Phase 04)

- Half-open `[start,end)` UTC intervals; business-local `YYYY-MM-DD` days.
- DST: gap → roll forward; ambiguity → first occurrence (unit-tested, NYC 2026).
- Exceptions: date closure = whole local day; override = complement of
  windows is blocked; instant block = exact range. Conflict list is advisory;
  blocks NEVER alter/cancel bookings (invariant 5).
- Slots are advisory reads; **the booking write path must revalidate via the
  same engine inputs and enforce atomic staff-interval exclusivity
  (transactions; single-node rs0 is transaction-capable)** — cached/rate-limit
  responses can never authorize a commit.
- Buffer semantics: before → `[start-buffer, start+duration)`; after →
  `[start, start+duration+buffer)`; between ≡ after for single segment (real
  between-merge belongs to the Phase 04 multi-service composer).

## 5. Known Issues / Watch Items

- `uniq_booking_idempotency` (`businessId, idempotencyKey`, no partial filter)
  collides on missing keys (E11000 in tests). Phase 04 must always generate
  keys or add `partialFilterExpression`.
- Booking segment shape consumed by conflict/scan code:
  `segments: [{ staffId, service: { serviceId, ... }, startTime, endTime }]`
  with `Date` instants — Phase 04 writes must conform (or update those queries).
- Minor Phase 01 carries: register duplicate race, non-transactional outbox
  writes, one-owner-many-businesses not enforced.
- Exceptions conflict scan loads tenant bookings without segment-level index
  (fine now; revisize with Phase 04 booking indexes).
- `docs/data-api.md` is "proposed, not frozen" — update as-built notes if
  Phase 04 changes booking document shapes.

## 6. Environment Notes

- Docker Desktop may need starting manually; then `docker compose up -d
  mongodb rabbitmq mailpit`; Mongo must report `rs0` healthy before tests.
- Config defaults live in `apps/server/src/config/index.js` (works without `.env`).
- Test suites wipe `users`; re-run `npm run bootstrap:admin` (in apps/server)
  after test runs if you need the admin for manual flows (tests bootstrap
  their own admin).
- Server startup for E2E: `node apps/server/src/server.js` (background); RESTART
  IT after source edits — a stale process serving old code cost 2 E2E debugging
  cycles in this session.
- Timezone fixtures in tests: 2026-03-02/2026-03-08 (past!) — current-phase tests
  used 2026-11-02 (Monday); remember notice-window semantics when picking dates.

## 7. Next Task — Phase 04, first increment (suggested slice)

**Goal:** booking document lifecycle + atomic single-service creation.
1. Shared booking schemas already exist (`packages/shared/src/schemas/booking.js`:
   create/reschedule/cancel, segments with service snapshot, `staffId|'any'`,
   idempotencyKey). Review and extend for snapshot population server-side.
2. Booking write service: validate (verified customer, approved+published
   business, active service, eligible staff or 'any' resolution), revalidate
   availability via slot-engine inputs, then commit atomically (Mongo
   transaction with a conflict guard — e.g., re-check active booking overlap
   inside the transaction and/or a unique per staff/time approach; document
   the exact guarantee honestly, rs0 supports multi-doc transactions).
3. Outbox `booking.confirmed` event written in the same transaction (ADR-009).
4. Integration tests: happy path, cross-tenant rejection, unverified customer
   rejection, 'any' resolution, idempotent retry (same key → same booking,
   not a duplicate), concurrent double-booking test (two parallel creates,
   exactly one succeeds), transaction rollback test.
5. HTTP routes + docs + log + commit. Then subsequent increments: reschedule,
   cancel + policy, customer-facing getters, no-show/complete, audit events.

Acceptance criteria: single-service creation returns 201 with segments
snapshotted server-side; parallel identical requests cannot both confirm the
same staff interval; booking + outbox event commit or fail together.
