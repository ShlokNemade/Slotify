# AI Agent System Instructions — Slotify

Strict instructions for AI agents developing in this repository.

## 1. Project Invariants (Non-Negotiable)

1. **Pure JavaScript:** All code must be `.js` / `.jsx`. No TypeScript (`.ts`, `.tsx`, `.d.ts`, `tsconfig.json`).
2. **Feature-Based Full-Stack Development:** Build vertically in complete feature slices across Database, Server API, and Client UI all in the same phase.
3. **Mandatory UI/UX Skill (`ui-ux-pro-max`):** For all frontend UI development, styling, layouts, component design, and accessibility, agents MUST follow the design intelligence skill in `.agents/skills/ui-ux-pro-max/SKILL.md`.
4. **Authoritative Backend:** Booking validation and database commits are authoritative; client checks and rate limiters never guarantee slot availability.
5. **Tenant Isolation:** All business operations and entities (`services`, `staff`, `schedules`, `bookings`, `exceptions`, `restrictions`) are strictly scoped by `businessId`. Cross-tenant access returns 403.
6. **No Silent Schedule Changes:** Adding exceptions/blocks never cancels or mutates existing confirmed bookings.
7. **Async Notifications:** Email and messaging run asynchronously via outbox/workers; notifications never block or determine booking confirmation.
8. **Local Commits Only:** Never push to remote. Use conventional commit messages (`feat`, `fix`, `test`, `chore`, `docs`).
9. **Advisory Reads:** Generated availability slots are advisory. Write operations must re-validate availability and enforce exclusivity within an atomic MongoDB transaction (`rs0`).

## 2. Project Scope (College Mini-Project MVP)

- **Target:** Demonstrable, functional appointment-booking platform with edge distributed rate limiting for college project evaluation.
- **Workflow:** End-to-end full-stack slices (DB + Server + Client) per phase.
- **Roadmap (Phases 04–08):**
  - **Phase 04:** Core Booking & Scheduling Flow (Client scaffold, DB booking model, Server write/cancel APIs, Client booking & cancellation UI via `ui-ux-pro-max`).
  - **Phase 05:** Notifications & Alerts Flow (Outbox collection, Mailpit dispatch worker, Client in-app notification center).
  - **Phase 06:** Edge Distributed Rate Limiting & Demo (Edge middleware, In-memory KV, sliding-window token bucket engine, global sync batching, Client 429 UI & faculty demo panel).
  - **Phase 07:** Owner Business Setup & Admin Portal (Owner profile/hours/services/staff management UI, Admin approval UI via `ui-ux-pro-max`).
  - **Phase 08:** Evaluation Seed & Submission Package (Automated seed script, faculty demonstration script).
- **Deferred to Phase X (Post-Submission):** Complex multi-service DAG scheduling, 24h booking proposal workflows, chaos/partition fault-injection.

## 3. Workflow & Verification Rules

- Inspect existing code and logs (`docs/implementation-log/phase-*.md`) before modifying files.
- Consult `.agents/skills/ui-ux-pro-max/SKILL.md` before generating or modifying any client React components, layouts, or CSS tokens.
- Run tests (`npm test`) and linter (`npm run lint`) after modifications. Never report unverified passes.
- Do not add speculative enterprise abstractions; keep code lean, maintainable, and MVP-focused.
- Maintain single-phase documentation in `docs/implementation-log/phase-XX.md` (no incremental sub-logs).
