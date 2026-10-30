# Technical Decisions & Status Tracker

Compact tracking of resolved decisions, MVP conventions, and deferred topics.

| Area | Topic | Status / Decision | Rationale |
|---|---|---|---|
| **Booking Concurrency** | Double-booking prevention | **Resolved (MVP):** MongoDB transaction (`rs0`) + active booking overlap revalidation prior to insert. | Native ACID guarantee in single-node replica set; tested under concurrent load. |
| **Service Snapshots** | Pricing & duration drift | **Resolved (MVP):** Snapshot `name`, `price`, `durationMinutes`, `bufferMinutes` on booking record. | Historical booking integrity preserved regardless of subsequent service changes. |
| **Schedule Exceptions** | Existing booking conflict | **Resolved (MVP):** Advisory warnings only; blocks never cancel or alter confirmed bookings. | Enforces strict non-destructive invariant. |
| **Edge Rate-Limiting** | Distributed token bucket | **Active Requirement (MVP Phase 06):** Edge worker/middleware, in-memory KV store, sliding-window token bucket engine with global sync batching. | Required core capability for college submission and faculty evaluation. |
| **Multi-Service Chaining** | Sequential DAG scheduling | **Deferred (Phase X):** Single-service bookings prioritized for College MVP. | Minimizes combinatorial scheduling complexity for evaluation timeline. |
| **Owner Proposals** | 24h slot renegotiation | **Deferred (Phase X):** Direct owner cancel/mark no-show supported; proposal negotiation deferred. | Simplifies booking state machine. |
| **Slug Reuse / Redirects** | Business slug modification | **Resolved (MVP):** Unique active slug enforced. Historical redirects deferred. | Sufficient for MVP requirements. |
