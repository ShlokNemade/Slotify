# Implementation Phases Roadmap

**Target:** College Mini-Project MVP (Full-stack demonstrable platform).  
**Development Method:** **Feature-Based Vertical Slices (DB + Server + Client All-in-One)**.  
**Phase Documentation Rule:** One log document per phase in `docs/implementation-log/phase-XX.md` (no incremental sub-logs).

---

## Completed Phases (Backend Foundations)

- **Phase 00 — Repository Baseline & Audit:** Environment inspection, pure JavaScript verification, workspace audit.
- **Phase 01 — Domain, Security & Environment Foundations:** Docker Compose (`rs0` Mongo, RabbitMQ, Mailpit), `@slotify/shared` Zod schemas, Express auth, sessions, password hashing, verification, tenant middleware.
- **Phase 02 — Business Setup & Directory APIs:** Password reset, owner business CRUD, services & staff CRUD, admin review/bootstrap CLI, public directory and profile endpoints.
- **Phase 03 — Availability Engine & Slots API:** Interval math, DST-safe schedule expansion, availability exceptions CRUD with advisory conflict detection, pure slot engine (`slot-engine.js`), owner availability and public slots APIs.
- **Phase 04 — Core Booking & Scheduling Flow:** Transactional booking creation, idempotency, customer cancellation, owner booking status management, and React/Vite booking client.

---

## Active Feature-Based Roadmap (Full-Stack Vertical Slices)

### Phase 05 — Notifications & Alerts Flow (Full-Stack Feature)
*Complete notification lifecycle from outbox to email and UI alerts.*
- **Database (DB):** `outbox` collection, `notifications` collection with read/unread state.
- **Server / Worker:** Background worker polling outbox, Mailpit SMTP dispatch (`user.verification_requested`, `booking.confirmed`, `booking.cancelled`).
- **Client UI:** In-app notification bell & dropdown in client navigation bar displaying live notification history and unread count.

### Phase 06 — Edge Distributed Rate Limiting & Demo (Full-Stack Feature)
*Full edge middleware, in-memory KV, and client-visible rate-limiting controls.*
- **Edge / Middleware:** Edge Worker / Cloud Function middleware with In-Memory KV store.
- **Engine:** Sliding-window token bucket engine with global sync batching on sensitive routes (`/auth/*`, `/bookings`).
- **Server API:** Returns standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers and HTTP 429.
- **Client UI & Demo:** Client toast/banner on 429 response, plus an interactive demo panel to trigger burst limits live for faculty evaluation.

### Phase 07 — Owner Business Setup & Admin Portal (Full-Stack Feature)
*Complete management interface for business owners and platform administrators.*
- **Server API:** Existing owner business/services/staff/exceptions endpoints (Phase 02/03) & admin endpoints.
- **Client UI:**
  - Owner dashboard: Edit business profile, operating hours, manage services & staff, view appointments calendar.
  - Admin dashboard: Review pending businesses (`pending_approval`), approve/reject with notes.

**Current status:** The owner workspace and admin review client surfaces are implemented ahead of the Phase 06 rate-limiting gate so all existing backend capabilities are demonstrable before starting new platform work.

### Phase 08 — Evaluation Seed & Submission Package (Demo Ready)
*End-to-end evaluation walkthrough for faculty presentation.*
- Automated database seed script (`npm run seed`) with sample businesses, staff, slots, and bookings.
- Repeatable evaluation walkthrough demonstrating full client booking, Mailpit notifications, and rate-limiting limits live.

---

## Phase X — Post-Submission Scope (Deferred Complexity)

*Deferred beyond college submission to avoid unnecessary complexity:*
- **X.1 Multi-Service Atomic DAGs:** Sequential multi-segment chaining with `between` buffer merging.
- **X.2 Owner Booking Proposals:** 24-hour proposal-counterproposal negotiation state machine.
- **X.3 Chaos Fault Injection:** Simulated network partition test harnesses and dead-letter replay dashboards.
- **X.4 Deep Enterprise Analytics:** Business utilization heatmaps and long-term cohort analytics.
