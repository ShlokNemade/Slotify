# Testing, Benchmarks, and Operations

## Test layers

- **Unit:** availability generation, duration/buffers, DST boundaries, staff eligibility, cancellation/reschedule/proposals, restrictions, token bucket, sliding window, leases and batch deduplication.
- **Integration:** auth/session revocation, tenant isolation, MongoDB transaction/outbox, multi-service concurrency, RabbitMQ retries/dead-letter/replay, Mailpit adapter, in-app notifications, restriction expiry/audit, multi-worker rate limiting.
- **Browser E2E:** registration/verification, directory and booking, partial availability choice, confirmation race, cancellation/reschedule, owner schedule conflicts, proposal accept/reject/expiry, dashboards/admin, mobile booking.
- **Fault injection:** Worker crash/restart, partition, stale KV, lost/delayed/duplicate batches, queue/email outage, worker crash, DB transaction conflict, recovery.

## Booking concurrency proof

Run simultaneous requests against overlapping intervals for the same staff. Verify no overlapping confirmed assignments, no partial multi-service booking, idempotent retries, refreshed availability for losers, and matching audit/outbox state. Sequential tests alone do not prove concurrency safety.

## Rate-limit benchmarks

Compare against a simple baseline. Record environment, workload, concurrency, throughput, p50/p95/p99 latency, accepted/blocked counts, false accepts/blocks where measurable, coordination lag, overshoot, recovery time, and resource use. Include normal/burst traffic, many tenant keys, hot keys, restarts, partitions, stale reads, lost/duplicated batches, and recovery. Define thresholds after baseline measurements; do not fabricate results.

## Operational dashboard

Show request/blocked rates, sync lag, stale/missing/duplicate batches, queue depth/consumer health, outbox age, notification retries/dead letters, booking conflicts/retries, application/database health, and relevant admin actions. Use structured logs with correlation IDs. Redact passwords, cookies, tokens, and sensitive payloads.

## Local-first setup

Document runtime versions, environment variables, MongoDB transaction-capable topology, RabbitMQ, Mailpit, frontend/API/worker commands, bootstrap/seed, tests, benchmarks, troubleshooting, and optional free-tier deployment. Verify provider quotas at implementation time.

## Definition of done

Acceptance criteria pass; relevant tests run; failure paths are covered; docs updated; tenant/security boundaries reviewed; commands and actual results recorded; unverified behavior and limitations disclosed.
