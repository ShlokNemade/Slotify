# Architecture Decision Records

All entries below are proposals unless explicitly labeled a product constraint.

## ADR-001 — React + Vite + JavaScript

**Why:** component-based UI, fast local iteration, typed client code.  
**Alternatives:** Next.js, plain JavaScript.  
**Trade-offs:** client-side routing/data-loading conventions need selection; SSR is not currently required.

## ADR-002 — Express + JavaScript

**Why:** lightweight API and straightforward middleware.  
**Alternatives:** NestJS.  
**Trade-offs:** project must define its own modular boundaries and validation conventions.

## ADR-003 — MongoDB

**Why:** proposed stack and document-oriented domain model.  
**Alternatives:** PostgreSQL.  
**Trade-offs:** transaction-capable topology is required; indexes alone do not prevent arbitrary interval overlap. Prove concurrency safety in tests.

## ADR-004 — Workers + KV with stronger coordination where needed

**Why:** directly addresses edge-worker and KV assignment primitives.  
**Alternatives:** local edge simulation; Durable Objects or another atomic coordinator for selected scopes.  
**Trade-offs:** KV is eventually consistent; bounded leases allow possible overshoot and global usage lag. Validate quotas and semantics.

## ADR-005 — RabbitMQ + transactional outbox

**Why:** booking commit and notification event are stored atomically; delivery occurs asynchronously.  
**Alternatives:** managed queue behind an abstraction; RabbitMQ locally with a later adapter.  
**Trade-offs:** extra operational complexity; at-least-once delivery requires idempotent workers, retries, dead-letter handling, and reconciliation.

## ADR-006 — Local-first deployment

**Why:** repeatable demonstration without mandatory paid services.  
**Trade-offs:** local simulation may not reproduce cloud consistency/failure behavior. Clearly label simulated versus provider-backed tests.

## ADR-007 — Server-managed cookie sessions

**Why:** central revocation and familiar browser model.  
**Trade-offs:** CSRF protection and session-store strategy are required. Alternative: access/refresh token design.

## ADR-008 — Atomic multi-service booking

**Status:** established product constraint.  
**Decision:** all service segments and staff assignments commit together or none.  
**Why:** prevents a partial booking that violates customer intent.  
**Validation:** concurrent requests, rollback, idempotency, and conflict tests.

## ADR-009 — Async notification outbox

**Why:** booking confirmation is independent of email delivery; outbox closes the DB/message publish gap.  
**Trade-offs:** eventual delivery and duplicate handling. Validate queue outage, replay, and idempotency.

## ADR-010 — Simplified cancellation policy

**Why:** payments are out of scope; complex payment-dependent time windows add no value to the current requirements.  
**Decision:** customer cancellation before appointment start, with separate abuse controls for repeated slot manipulation.  
**Trade-offs:** non-payment business policies may be requested later.
