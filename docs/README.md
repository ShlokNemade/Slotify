# Slotify

Slotify is a multi-tenant appointment-booking platform and a demonstration of edge-based distributed rate limiting. This is a **requirements and design proposal**, not an instruction to begin implementation.

## Stack proposed
- Frontend: React + Vite + JavaScript
- API: Node.js + Express + JavaScript
- Database: MongoDB with transactions and indexes
- Edge: Cloudflare Workers + KV, plus stronger coordination where required
- Notifications: RabbitMQ, transactional outbox, and workers
- Delivery: local demonstrable setup first; optional free-tier deployment documented

## Documents
- `docs/AGENTS.md` — AI coding-agent workflow and invariants
- `docs/requirements.md` — product requirements and business rules
- `docs/ui-ux.md` — design direction, navigation, and page behavior
- `docs/architecture.md` — system boundaries, flows, and failure strategy
- `docs/data-api.md` — logical data model and API conventions
- `docs/security.md` — authentication, authorization, and privacy
- `docs/rate-limiting.md` — assignment-specific rate-limiting design
- `docs/decisions.md` — decisions, rationale, alternatives, and trade-offs
- `docs/testing-operations.md` — tests, benchmarks, monitoring, local setup
- `docs/implementation-phases.md` — phased implementation sequence
- `docs/open-questions.md` — remaining technical decisions

## Non-negotiable boundaries
1. Rate limiting is not booking concurrency control.
2. Backend booking validation and commit are authoritative.
3. Multi-service booking is all-or-nothing.
4. Booking confirmation never waits for email delivery.
5. Cloudflare KV is eventually consistent and cannot by itself guarantee atomic global counters.
6. Verify free-tier quotas and provider terms when implementation begins; no paid service is mandatory for local demonstration.
