# Testing and Operations Guide

Machine-actionable operational guide and testing instructions.

## 1. Local Infrastructure Setup

```bash
# Start required local containers (MongoDB replica set 'rs0', RabbitMQ, Mailpit)
docker compose up -d

# Verify MongoDB replica set health
docker compose exec mongodb mongosh --eval "rs.status().ok"

# Mailpit web UI available at http://localhost:8025
# RabbitMQ management UI at http://localhost:15672
```

## 2. Testing & Verification Commands

```bash
# Run all unit and integration test suites
npm test

# Run ESLint across monorepo
npm run lint

# Bootstrap platform admin user (apps/server)
npm run bootstrap:admin
```

## 3. Concurrency & Booking Verification Rules

- **Exclusivity Invariant:** Two simultaneous create-booking requests for the same staff member and overlapping time window must never both succeed. Exactly one must return `201 Created`; the other must return `409 Conflict`.
- **Atomic Commits:** Booking record and outbox record must commit together or not at all.
- **Throwaway E2E Scripts:** Run ephemeral integration tests via real Node HTTP processes (`node apps/server/src/server.js`); do not commit throwaway test scripts into the repo.
