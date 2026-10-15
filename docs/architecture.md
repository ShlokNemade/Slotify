# System Architecture

**Status:** proposed architecture. Validate provider semantics and concurrency assumptions before implementation.

## Components

- React + Vite + JavaScript customer/owner UI and separate admin area.
- Cloudflare Worker edge layer for route classification and rate limiting.
- Cloudflare KV for suitable eventually consistent state/configuration, not atomic global counters.
- Stronger scoped coordination where required; exact primitive remains open.
- Node.js + Express + JavaScript authoritative API.
- MongoDB for business data, booking state, audit, notifications, and outbox.
- RabbitMQ and background workers for asynchronous notification delivery.
- Mailpit/local email sandbox; configurable provider adapter for optional deployment.

## Booking write path

1. Client submits request with idempotency key.
2. API authenticates, checks verification, tenant scope, booking policy, and abuse restrictions.
3. API recalculates service order, durations, buffers, staff qualifications, schedules, and availability.
4. A concurrency-safe transactional operation secures every segment and staff assignment, writes booking/audit data, and writes an outbox event.
5. If any segment fails, commit no partial booking and return refreshed options.
6. Return confirmed status after successful authoritative commit.
7. Publisher sends outbox event to RabbitMQ asynchronously.
8. Workers send email and create in-app notifications idempotently. Delivery failure never undoes booking.

MongoDB transactions alone are not assumed to prevent arbitrary interval overlap. The exact conflict-prevention mechanism must be selected and proven by concurrent tests.

## Availability read path

Expand recurring schedules and exceptions in the business time zone; filter candidates by interval, service duration/buffers, staff eligibility, shifts, breaks, leave, business closures, notice/horizon, and existing bookings. Return bookable slots only. Results are advisory until the write path revalidates.

## Background jobs

- Outbox publisher and reconciliation
- Notification workers with retry/backoff/dead-letter handling
- Reminder scheduling at 24h and 2h, recalculated after changes
- Restriction expiry
- Five-second initial rate-limit usage synchronization
- Monitoring for stuck outbox entries, queue failures, missing/duplicate batches

## Boundaries and failure behavior

- Every tenant-owned record and owner operation is business-scoped.
- Platform-admin authorization is separate.
- Public APIs return allowlisted published data.
- Database commit failure means no confirmed booking.
- Queue/email outage does not undo a booking.
- Coordination failure uses bounded local rate limits; sensitive operations may fail closed if their required guarantees cannot be maintained.
- Sync batches require stable IDs, deduplication, retry, and reconciliation.
- Rate limiting never substitutes for authoritative booking validation.
