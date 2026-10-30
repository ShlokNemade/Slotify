# Session Handoff — Slotify

**Updated:** 2026-10-30  
**Branch:** `main`  
**Phase Status:** Phase 05 Complete. Ready for Phase 06 (Edge Distributed Rate Limiting & Demo — Full-Stack).  
**Phase Log Rule:** Single file per phase (`docs/implementation-log/phase-XX.md`).  
**Development Method:** **Feature-Based Vertical Slices (DB + Server + Client All-in-One)**.  
**Design Intelligence Skill:** **`ui-ux-pro-max`** (`.agents/skills/ui-ux-pro-max/SKILL.md`) is mandatory for all frontend UI.

---

## 1. Verified Baseline (Do Not Re-implement)

- **Phases 00–05 Complete:**
  - Docker Compose (`rs0` MongoDB replica set, RabbitMQ, Mailpit).
  - Auth, password reset, sessions, tenant isolation (`requireBusinessOwnership`).
  - Owner business, services, and staff CRUD (soft-deactivation).
  - Admin bootstrap CLI (`npm run bootstrap:admin`) and business review endpoints.
  - Public directory and business profiles by slug.
  - Schedule expansion, tenant exceptions with advisory conflict warnings, pure slot engine (`slot-engine.js`), and public slots API.
- **Transactional booking creation, customer cancellation, owner status management, and React/Vite client booking flow.**
- **Asynchronous outbox notification worker, Mailpit delivery, notification APIs, and client notification center.**
- **Client account creation/sign-in surface and isolated local demo seed:** `npm run seed:demo` (remove with `npm run seed:demo -- --reset`).
- **Owner workspace and platform-admin review UI:** `/owner` and `/admin` cover the existing business, catalog, schedule, availability, booking-management, and review APIs.
- **Test Baseline:** `npm test` -> 123/123 passing. `npm run lint` -> clean. Client remains development-only; no production build artifacts are required.

## 2. Binding Rules for Next Phases

1. **Feature-Based Full-Stack Slices:** Each phase must implement its feature end-to-end: Database schema/indexes, Server API routes, and Client UI components all together.
2. **Mandatory UI/UX Skill (`ui-ux-pro-max`):** All client interface design, component layout, and styling must follow `.agents/skills/ui-ux-pro-max/SKILL.md`.
3. **Advisory Reads:** Generated slots are advisory reads. The booking write path must independently re-validate availability and enforce exclusivity within an atomic MongoDB transaction (`rs0`).
4. **Intervals:** Use half-open UTC intervals `[start, end)` in milliseconds.
5. **No Silent Changes:** Blocks/exceptions never cancel or mutate confirmed bookings.
6. **Tenant Scoping:** All operations scoped by `businessId`. Cross-tenant calls return 403.
7. **Outbox Pattern:** Commit booking document and outbox event (`booking.confirmed`) in the same MongoDB transaction.

## 3. Next Task: Phase 06 — Edge Distributed Rate Limiting & Demo (Full-Stack Feature)

**Feature Goal:** Add edge rate limiting, standard 429 headers, and a client-visible demonstration flow.

### Phase 06 focus
- Add edge middleware and a bounded in-memory KV implementation.
- Add sliding-window token bucket enforcement and standard rate-limit headers.
- Add client 429 feedback and a faculty demonstration panel.

## 4. Environment & Operations Note

- MongoDB replica set `rs0` must be healthy (`docker compose up -d mongodb`).
- Mailpit available at `http://localhost:8025`.
- Tests re-seed test users; re-run `npm run bootstrap:admin` in `apps/server` if testing manual flows.
