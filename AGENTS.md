# Slotify Agent Guidance

Slotify follows strict coding invariants and phased development workflows.

See full agent instructions in [`docs/AGENTS.md`](./docs/AGENTS.md).

## Critical Invariants
1. **JavaScript Requirement:** Pure JavaScript throughout (`.js`, `.jsx`). No TypeScript.
2. **Authoritative Backend:** Booking validation and database commits are authoritative; rate limiting does not prevent double-booking.
3. **Atomic Multi-Service:** Multi-service bookings commit all segments or none.
4. **Tenant Isolation:** All business entities (`services`, `staff`, `schedules`, `bookings`, `restrictions`) are strictly scoped by `businessId`.
5. **No Silent Schedule Changes:** Adding schedule blocks never cancels or alters existing confirmed bookings.
6. **Async Notifications:** Email/messaging never blocks booking confirmation.
7. **Local Commits Only:** Never push to remote. Use conventional commits (`feat`, `fix`, `test`, `chore`, `docs`).
