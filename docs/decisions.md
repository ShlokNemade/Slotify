# Architecture Decision Records (ADR)

Compact log of binding architectural and design decisions.

| ADR | Topic | Decision | Rationale |
|---|---|---|---|
| **ADR-001** | Language | Pure JavaScript (`.js`, `.jsx`) | Strict project invariant; no TypeScript compilation step. |
| **ADR-002** | API Framework | Node.js + Express | Lightweight, straightforward middleware composition. |
| **ADR-003** | Database | MongoDB Replica Set (`rs0`) | Document model matching domain entities; supports multi-document ACID transactions for booking commits. |
| **ADR-004** | Rate Limiting | Edge Worker / Middleware + In-Memory KV | Core project requirement: sliding-window token bucket engine with periodic global sync batching to demonstrate edge-based distributed rate limiting. |
| **ADR-005** | Session Management | Server-side sessions + HttpOnly cookies | Secure token revocation and browser standard compliance. |
| **ADR-006** | Availability Math | Pure UTC half-open intervals `[start, end)` | Deterministic, timezone-safe slot computation avoiding DST boundary ambiguities. |
| **ADR-007** | Concurrency Control | Authoritative transactional commit | Generated slots are advisory; booking writes re-validate availability inside an atomic MongoDB transaction. |
| **ADR-008** | Notifications | Asynchronous Outbox Pattern | Outbox events commit in the same transaction as the booking; notifications never block or fail booking creation. |
| **ADR-009** | Schedule Exceptions | Non-destructive blocks | Adding an exception generates advisory warnings for existing bookings but never alters or cancels confirmed bookings. |
| **ADR-010** | Cancellation Policy | Simple pre-start cancellation | Customer can cancel before `startTime`. Payments/refunds are out of scope. |
| **ADR-011** | Project Scope | College Mini-Project MVP | Demonstrable end-to-end booking flow and edge rate-limiting middleware prioritized for submission; complex multi-service DAGs and 24h proposal state machines deferred to Phase X. |
