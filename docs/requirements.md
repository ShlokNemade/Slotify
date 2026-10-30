# Product Requirements Specification

**Target:** College Mini-Project MVP (Single-service appointment booking platform with edge rate limiting).  
**Deferred Features:** Complex multi-service DAGs and 24h proposal negotiations are moved to Phase X.

---

## 1. Roles & Permissions

| Role | Access Scope | Login Type | Key Capabilities |
|---|---|---|---|
| **Customer** | Global across all tenants | Email + Password | Register, verify email, search directory, book slots, view/cancel own bookings |
| **Owner** | Scoped to owned `businessId` | Email + Password | Create business, configure hours/services/staff, view bookings, mark completed/no-show, add schedule blocks |
| **Staff** | Internal tenant record | No login | Defined by owner with qualifications and shifts; assigned to service bookings |
| **Platform Admin** | Global system access | CLI Bootstrap | Approve/reject businesses, inspect system health |

---

## 2. Domain Entities & Constraints

### 2.1 Accounts & Auth
- Sessions: Server-side stored sessions referenced by `HttpOnly` cookie or Bearer token.
- Passwords: Minimum 8 characters, hashed with bcrypt (12 rounds).
- Verification: 24h single-use token required before creating businesses or booking slots.
- Password Reset: Non-enumerating token generation and secure reset endpoint.

### 2.2 Businesses & Directory
- Statuses: `draft` -> `pending_approval` -> `approved` (or `rejected`).
- Public Listing: Business must be `approved` and have >= 1 active service.
- Profile: Publicly exposes business description, hours, services, and display staff names (zero internal shifts, private appointments, or customer identities).
- Tenant Isolation: All operations on services, staff, bookings, exceptions, and settings enforce `businessId` ownership.

### 2.3 Availability Engine
- Intervals: Pure half-open UTC intervals `[start, end)`.
- Timezone/DST: Operating hours defined in business IANA timezone; DST nonexistent times roll forward, ambiguous times pick first occurrence.
- Exceptions: Date closures or custom blocked intervals. Adding an exception generates advisory warnings for existing bookings; it **never** alters or cancels confirmed bookings.
- Slot Generation: Anchored at local midnight; service duration + buffers (`before`, `after`, `between`) must fit within staff shift and business hours, minus existing bookings and exception blocks.
- Advisory Nature: Availability reads are strictly advisory; booking write path must independently re-validate.

### 2.4 Booking Lifecycle (MVP)
- **Status State Machine:**
  - `confirmed`: Created atomically after availability revalidation.
  - `cancelled`: Customer cancels prior to booking start time.
  - `completed`: Owner marks appointment fulfilled.
  - `no_show`: Owner marks customer absent.
- **Atomic Creation:** Booking commit requires a MongoDB transaction (`rs0`) ensuring the assigned staff has no overlapping confirmed booking.
- **Service Snapshotting:** Service `name`, `price`, `durationMinutes`, and `bufferMinutes` snapshotted on the booking record at creation time.
- **Cancellation:** Allowed for customers while `startTime > Date.now()`. Emits `booking.cancelled` outbox event.

### 2.5 Notifications (MVP)
- Outbox Pattern: Every transactional action writes an outbox record (`user.verification_requested`, `booking.confirmed`, `booking.cancelled`).
- Delivery: Background worker polls outbox, dispatches email to Mailpit sandbox, and writes in-app notification records.
- Resilience: Notification failures never roll back or block booking confirmation.

### 2.6 Edge-Based Distributed Rate Limiting (MVP Core)
- **Layer:** Edge Worker / Cloud Function middleware with In-Memory KV Store.
- **Engine:** Sliding-window token bucket engine handling request bursts and sliding-window limits on sensitive routes (`/auth/*`, `/bookings`).
- **Batch Synchronization:** Local instance counts flushed periodically to global sync state.
- **Client Visibility:** Returns standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) and returns HTTP 429 when limits are breached.

---

## 3. Post-Submission Scope (Phase X - Extended)

1. **Multi-Service Atomic DAGs:** Sequential multi-service booking chains with complex buffer placement and subset alternative recovery.
2. **Owner Booking Proposals:** 24h alternative time negotiation state machine.
3. **Operations & Chaos Benchmarks:** Network partition chaos testing, dead-letter replay management, utilization analytics heatmaps.
