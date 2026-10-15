# Logical Data Model and API Contracts

**Status:** proposed logical model, not a frozen schema.

## Data principles
- Business-owned records are tenant-scoped with `businessId`.
- Customer identity is global; bookings link `customerId` and `businessId`.
- Store appointment instants consistently (UTC proposed) and retain the business IANA zone.
- Preserve append-only audit events.
- Recommended: snapshot service name, duration, and displayed price at booking time.
- A normal index does not enforce arbitrary interval non-overlap; concurrency strategy must be documented separately.

## Proposed entities
- **User:** normalized unique email, password hash, verification timestamp, account status.
- **Session:** user, safe session identifier/hash, creation/expiry/revocation timestamps.
- **Business:** owner, slug, approval/publication status, profile, location, time zone, hours, booking horizon.
- **Service:** business, name/description, duration, optional displayed price, eligible staff, buffer duration/placement, active state.
- **Staff:** business, display name, qualifications, shifts, breaks, leave/exceptions; no login.
- **AvailabilityBlock/Exception:** business, optional staff/service scope, interval/recurrence, reason, conflict-review state.
- **Booking:** business/customer, status, aggregate start/end, ordered segments, idempotency key, change metadata.
- **BookingSegment:** service snapshot, staff assignment, start/end, buffer interpretation.
- **BookingProposal:** proposed alternative, proposer, 24-hour expiry, decision; does not reserve slot.
- **Restriction/AbuseEvent:** business/platform scope, customer, category, start/expiry/status, rule version, lift/expiry audit.
- **Notification:** user, channel/type, read state, delivery state.
- **OutboxEvent:** stable event ID, aggregate/type, payload version, publish attempts/state.
- **AuditEvent:** actor, scope, action, target, timestamp, reason, safe before/after summary.
- **RateLimitUsage/SyncBatch:** namespace, key identifier/hash, window, batch ID/version, acknowledgement state.

## Index candidates
Unique normalized user email; unique active business slug; booking indexes by business/status/start, customer/start, business/staff/start; unique idempotency scope/key; outbox status/next attempt; notifications by user/created; active restrictions by business/customer/status/expiry. Validate against query plans. Indexes alone do not prevent overlapping intervals.

## API conventions
- Versioned JSON API, e.g. `/api/v1`.
- Server-side request validation and authorization.
- Consistent safe error envelope and correlation ID.
- Pagination for collections.
- Explicit time-zone metadata in scheduling responses.
- Idempotency keys for retry-sensitive commands.
- Never trust client-provided roles, owner IDs, duration, price, staff eligibility, or availability.

## Candidate route groups
Auth: register customer/owner, verify email, login/logout/session, request/complete password reset.
Public: directory, business by slug, services, availability.
Customer: own bookings, create/cancel/reschedule, accept/reject owner proposal, notifications.
Owner: profile/setup, services/staff/schedules, booking actions, analytics, protection, audit.
Admin: tenant review, platform health, rate-limit metrics, queue failures/replay.

Routes are illustrative. Before implementation, specify request/response schemas, authorization, error cases, and tests for each endpoint.
