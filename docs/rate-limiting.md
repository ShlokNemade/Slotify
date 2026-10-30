# Distributed Rate-Limiting Design (MVP Core)

**Target:** College Mini-Project MVP — Faculty Evaluation Requirement.  
**Architecture:** Edge Worker / Middleware with In-Memory KV Store and Sliding-Window Token Bucket Engine.

---

## 1. Objective & Faculty Demonstration

Provide an edge-layer rate-limiting middleware that protects the API from abuse and demonstrates distributed rate limiting via:
1. **Edge Workers / Middleware:** Inspects incoming requests at the edge or ingress proxy.
2. **In-Memory KV Store:** Fast local state tracking (e.g. Miniflare / Cloudflare KV / In-Memory KV cache).
3. **Sliding-Window Token Bucket Engine:** Handles short-term bursts while enforcing sliding-window rate limits.
4. **Global Sync Batching:** Periodically synchronizes local batch usage counters to global state to maintain multi-instance coordination.
5. **Visible Headers & Status:** Returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `429 Too Many Requests`.

---

## 2. Algorithm & Engine Design

### 2.1 Sliding-Window Token Bucket
- **Token Bucket (Burst Guard):**
  - Configured with Capacity $B$ and refill rate $r$ tokens/second.
  - Calculated: $T_{\text{new}} = \min(B, T_{\text{prev}} + r \times dt)$.
  - Immediate burst protection per IP or tenant key.
- **Sliding-Window Counter (Quota Guard):**
  - Divides time into rolling windows (e.g., 60 seconds).
  - Approximates current window rate:
    $$\text{Count} = \text{CurrentWindowCount} + \text{PreviousWindowCount} \times \left(1 - \frac{t_{\text{elapsed}}}{\text{WindowSize}}\right)$$
  - Prevents boundary-burst attacks on sensitive endpoints (`/auth/login`, `/auth/register`, `/bookings`).

### 2.2 Global Sync Batching
- **Local Accumulation:** Worker instances record increments locally in an in-memory KV store to minimize latency.
- **Batch Dispatch:** At fixed intervals (e.g., every 5 seconds), local counts are flushed to the shared coordinator/KV store.
- **Lease Allocation:** Workers pull replenishment allowances during sync cycles.

---

## 3. Protected Route Registry

| Category | Target Endpoints | Quota (Example) | Key Scope |
|---|---|---|---|
| **Auth Sensitive** | `/api/v1/auth/login`, `/register`, `/reset-password` | 5 req / 1 min | `ip:route` |
| **Booking Mutations** | `POST /api/v1/bookings`, `POST /api/v1/bookings/:id/cancel` | 10 req / 1 min | `user:businessId` |
| **Public Directory** | `GET /api/v1/directory/*` | 60 req / 1 min | `ip:directory` |

---

## 4. Key Boundaries

1. **Authoritative Backend:** Rate limiting protects system resources and prevents spam; it is **not** a replacement for database transactions and authoritative slot exclusivity checks.
2. **Graceful Fallback:** If global sync is delayed, workers enforce bounded local limits without crashing the request pipeline.
