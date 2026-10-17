# Slotify

Slotify is a multi-tenant appointment-booking platform and a system-design demonstration of edge-based distributed rate limiting.

## Stack

- **Frontend:** React + Vite + JavaScript (JSX)
- **API:** Node.js + Express + JavaScript (ESM)
- **Database:** MongoDB (single-node replica set `rs0` with transactions)
- **Edge:** Cloudflare Workers + KV + bounded rate-limiting leases
- **Messaging:** RabbitMQ + transactional outbox pattern
- **Email Sandbox:** Mailpit for local development

## Documentation

All architectural decisions, product specifications, and operational guides are in [`docs/`](./docs/):

- [`docs/AGENTS.md`](./docs/AGENTS.md) — Coding agent invariants and rules
- [`docs/requirements.md`](./docs/requirements.md) — Product requirements and business rules
- [`docs/architecture.md`](./docs/architecture.md) — System boundaries and components
- [`docs/decisions.md`](./docs/decisions.md) — Architecture Decision Records (ADRs)
- [`docs/data-api.md`](./docs/data-api.md) — Logical data model and API conventions
- [`docs/rate-limiting.md`](./docs/rate-limiting.md) — Distributed rate-limiting design
- [`docs/security.md`](./docs/security.md) — Auth, sessions, and tenant isolation
- [`docs/testing-operations.md`](./docs/testing-operations.md) — Testing layers and benchmarks
- [`docs/ui-ux.md`](./docs/ui-ux.md) — UI/UX specification and design tokens
- [`docs/implementation-phases.md`](./docs/implementation-phases.md) — Phased rollout plan
- [`docs/implementation-log/`](./docs/implementation-log/) — Historical phase logs

## Quick Start

```bash
# 1. Start infrastructure (MongoDB Replica Set, RabbitMQ, Mailpit)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Bootstrap the platform admin (local only; see .env.example)
npm run bootstrap:admin --workspace=@slotify/server

# 4. Run the API server
npm run dev:server

# Tests
npm test                 # all workspaces
npm run lint             # eslint
```
