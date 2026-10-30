# Session Handoff — Slotify

**Last updated:** 2026-10-30 (UTC)
**Branch:** `main` · HEAD `520362f` · working tree clean
**Primary detailed source:** `docs/implementation-log/` (per-phase and per-increment logs)

---

## 1. Current Phase

**Phase 03 — Availability engine** is the active phase. Phases 00–02 are complete and verified
(see `phase-02-summary.md`). The availability engine implementation had **not** been started
before this session.

## 2. What is completed and verified (do not redo)

- **Phase 01 (domain/security foundations):** users/sessions/auth (register, verify-email, login,
  logout, me), tenant isolation middleware (`requireBusinessOwnership`), error envelope, Mongo
  index bootstrap, Express app skeleton.
- **Phase 02 increments (all E2E-verified over HTTP):**
  1. Password reset (non-enumerating, single-use, session revocation) — commit `baa0772`
  2. Owner business CRUD (draft/create/read/update, unique slug, per-day hours merge) — `0cc0878`
  3. Services & staff CRUD (tenant-scoped, eligibility membership validation, soft deactivation) — `ef631f9`
  4. Admin review + bootstrap (idempotent admin CLI, approve/reject + audit + outbox, submit lifecycle) — `55278a7`
  5. Public directory & profile (allowlisted projections, approval + completeness gate, filters/pagination) — `7853365`
- Infrastructure: Docker Compose `slotify-mongodb` (mongo:7.0, single-node `rs0`), RabbitMQ, Mailpit.
  Config in `apps/server/src/config/index.js` has safe defaults (works without `.env`).

## 3. Implemented but unverified / minor known issues

- Register endpoint duplicate-email race (see `phase-01-handoff-audit.md` §5.4) — only a
  pre-check + generic 500 backstop, not fixed yet.
- Outbox writes in some flows are non-transactional (audit §5.5). Phase 5 will revisit.
- One owner may currently create multiple businesses (requirements imply one). Not enforced.
- Outbox events (`business.approved`, `business.rejected`, password-reset) accumulate as
  `pending`; there is no publisher/worker yet (Phase 5).

## 4. How verification was done

- `npm test` (root) → shared schema unit tests + **52/52 server integration tests pass** against
  live `rs0` replica set (`node --test --test-concurrency=1`).
- `npm run lint` → 0 errors/0 warnings.
- E2E so far = **HTTP-level**, against real `node src/server.js` (no Playwright/client exists yet).
- Docker Desktop had to be started manually; stack via `docker compose up -d mongodb rabbitmq mailpit`.

## 5. Environment quick facts

- Node v24, npm workspaces: `packages/shared` (Zod schemas, `@slotify/shared`), `apps/server`.
- No client app yet. Pure JavaScript everywhere (no TS) — mandatory invariant.
- Auth via Bearer bearer token in tests; HttpOnly cookie sessions also exist.
- Admin bootstrap: `npm run bootstrap:admin` (in `apps/server`); test suites wipe the `users`
  collection between runs, so re-run bootstrap after test runs if you need the admin.
- **E2E incident pattern to remember:** wiped admin/service state after test runs; if an E2E flow
  fails with "not found", check DB state, not just code (see increment-05 log §9).

## 6. Next task (Phase 03, increment 01)

**Goal:** DST-correct schedule *expansion core* — pure functions (no DB) that turn stored
recurring schedules (business hours, staff shifts/breaks/leave, date exceptions) into concrete
UTC half-open intervals for a date range, using the business IANA time zone.

Acceptance criteria:
1. Pure module (`apps/server/src/services/availability/*` or similar) + unit tests (no Mongo);
   tests pass with `npm test`.
2. Weekly business-hour windows expand per business-local calendar date; closed days yield nothing.
3. **DST handled explicitly:** spring-forward gap and fall-back ambiguity in a real TZ (e.g.
   `America/New_York`) covered by unit tests. Gaps roll wall times forward to the transition
   instant; ambiguous times take the earlier offset. Document the policies in code + log.
4. Staff shifts expand, breaks subtract, leave subtracts; date-specific exceptions (closed or
   override-hours per business-local date) apply. Staff shifts are interpreted in the business TZ.
5. No DB writes, no route changes yet — expansion is pure and reusable by the later slot engine.
6. Implementation log `docs/implementation-log/phase-03-increment-01-*.md` with the above template.
7. Modular local commit (`feat(availability): ...`); **never push**.

Then: increment 02 = availability-block/exception data model + tenant-scoped owner CRUD with
conflict-warning scan against confirmed bookings (never alter bookings); increment 03 = slot
computation with notice/horizon/duration/buffers/eligibility + candidate generation at
`defaultSlotIntervalMinutes`; increment 04 = slot-computation API + integration tests + HTTP E2E.

## 7. Constraints to keep enforcing (from AGENTS.md / docs)

- JavaScript only (`.js`/`.jsx`), JSDoc welcome; Zod at trust boundaries.
- All bookable state authoritative in DB; rate limits and caches never gate correctness.
- Multi-service bookings atomic; schedule blocks never silently alter bookings.
- Tenant isolation (`businessId`) on every business-owned collection.
- Local commits only, conventional commit messages, tiny increments, docs updated per increment.
- Use installed **ui-ux-pro-max** skill and `docs/ui-ux.md` before any UI work (client phase).
