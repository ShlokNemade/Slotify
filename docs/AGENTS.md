# AI Coding Agent Instructions

- Read the relevant docs before changing code; inspect the repository before assuming its structure.
- Requirements are proposals, not permission to implement. Follow the user's explicit current task.
- Work in small, testable phases. Explain changed files, data flow, security implications, commands, and results.
- Never claim unrun tests or unverified behavior passed.
- Keep secrets out of source control; use `.env.example` placeholders.
- Preserve existing working code and conventions unless a change is justified.
- Update tests and docs with behavior changes.

## Invariants

- Enforce authorization server-side on every protected operation.
- Customer identity is reusable across businesses; business restrictions stay business-scoped.
- Staff are owner-managed records, with no separate staff login in the proposed scope.
- A confirmed booking is backed by an authoritative successful commit.
- Multi-service bookings commit all segments and staff assignments or none.
- Adding a schedule block never silently changes or cancels existing confirmed bookings.
- Notifications never determine whether a booking is confirmed.
- Workers must validate current booking state and use idempotency before sending.
- Rate limiting does not prevent double booking.
- KV alone cannot provide strict globally atomic counters.
- Public pages must not expose private appointments, customer data, internal schedules, or abuse signals.

## Expected verification

Unit and integration tests, browser end-to-end tests, booking concurrency tests, and rate-limit fault-injection tests as relevant to each phase.
