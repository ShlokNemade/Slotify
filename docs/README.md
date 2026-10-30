# Slotify Documentation Index

Multi-tenant appointment-booking platform with edge-based distributed rate limiting (College Mini-Project MVP).

## System Invariants

1. **Pure JavaScript:** Strictly `.js` / `.jsx`. No TypeScript.
2. **Authoritative Backend:** Database commits in MongoDB `rs0` are authoritative; slot reads and rate limiters are advisory.
3. **Tenant Isolation:** All business entities scoped by `businessId`.
4. **No Silent Schedule Changes:** Blocks never cancel or mutate confirmed bookings.
5. **Async Notifications:** Delivery occurs asynchronously via outbox worker; does not block booking confirmation.
6. **Local Commits Only:** Never push to remote. Conventional commit format.

## Documentation Index

- [`docs/AGENTS.md`](./AGENTS.md): Machine-actionable agent instructions and coding rules.
- [`docs/SESSION_HANDOFF.md`](./SESSION_HANDOFF.md): Live project state, completed increments, and immediate next phase.
- [`docs/implementation-phases.md`](./implementation-phases.md): College MVP roadmap (Phases 00–08) and deferred Phase X.
- [`docs/requirements.md`](./requirements.md): Functional requirements, user roles, state machines, and edge rate limiting.
- [`docs/architecture.md`](./architecture.md): Topology, component boundaries, edge rate limiting, and booking read/write flows.
- [`docs/data-api.md`](./data-api.md): Schema definitions, database indexes, and API route registry.
- [`docs/decisions.md`](./decisions.md): Architecture Decision Records (ADR-001 through ADR-011).
- [`docs/security.md`](./security.md): Authentication, sessions, RBAC, and data sanitization.
- [`docs/testing-operations.md`](./testing-operations.md): Setup, test commands, and concurrency verification rules.
- [`docs/ui-ux.md`](./ui-ux.md): React single-page application specifications (Customer, Owner, Admin).
- [`docs/rate-limiting.md`](./rate-limiting.md): Edge distributed rate-limiting design (sliding-window token bucket + sync batching).
- [`docs/open-questions.md`](./open-questions.md): Decisions log and MVP scoping matrix.
- [`docs/implementation-log/`](./implementation-log/): Single per-phase logs (`phase-00.md` through `phase-05.md`).
