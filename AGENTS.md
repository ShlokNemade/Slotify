# Slotify Agent Guidance

Slotify follows strict coding invariants and phased development workflows for a College Mini-Project MVP.

See full agent instructions in [`docs/AGENTS.md`](./docs/AGENTS.md).

## Critical Invariants

1. **JavaScript Requirement:** Pure JavaScript throughout (`.js`, `.jsx`). No TypeScript.
2. **Feature-Based Full-Stack Development:** Build vertically in complete feature slices across Database, Server API, and Client UI all in the same phase.
3. **Mandatory UI/UX Skill (`ui-ux-pro-max`):** All frontend UI design, components, styling, and accessibility MUST consult and follow `.agents/skills/ui-ux-pro-max/SKILL.md`.
4. **Authoritative Backend:** Booking validation and database commits are authoritative; rate limiting does not prevent double-booking.
5. **Tenant Isolation:** All business entities (`services`, `staff`, `schedules`, `bookings`, `exceptions`, `restrictions`) are strictly scoped by `businessId`.
6. **No Silent Schedule Changes:** Adding schedule blocks never cancels or alters existing confirmed bookings.
7. **Async Notifications:** Email/messaging never blocks booking confirmation.
8. **Local Commits Only:** Never push to remote. Use conventional commits (`feat`, `fix`, `test`, `chore`, `docs`).
9. **Advisory Reads:** Generated slots are advisory; write path revalidates and enforces exclusivity in an atomic MongoDB transaction.
