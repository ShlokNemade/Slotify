# Implementation Phases

Phases improve reliability; they do not reduce the intended product scope. Do not begin until instructed.

0. **Repository/local environment:** inspect repo; tooling, env templates, MongoDB transaction topology, RabbitMQ, Mailpit, health checks, admin bootstrap.
1. **Domain/security foundations:** users, sessions, businesses, services, staff, schedules, bookings, audit, notifications/outbox/restrictions; auth, verification, reset, tenant isolation.
2. **Business setup and directory:** owner onboarding/approval, profiles/slugs, services/staff/hours, public directory/profile.
3. **Availability engine:** recurring hours, exceptions, time zones/DST, shifts/breaks/leave, qualifications, durations/buffers, notice/horizon.
4. **Booking integrity/lifecycle:** guided flow, multi-service atomic booking, concurrency-safe assignment, cancel/reschedule/proposals, audit/no-show/completion.
5. **Notifications:** outbox, RabbitMQ publisher/workers, Mailpit/provider adapter, in-app history, reminders, retries, dead-letter/replay.
6. **Abuse and rate limiting:** configurable protections, expiry/lift/audit, Worker middleware, token bucket/sliding window, leases, sync batches, stronger coordination.
7. **Dashboards/analytics:** owner pages, separate admin area, operational monitoring.
8. **Fault injection and benchmarks:** crash/partition/batch/queue/concurrency tests; baseline comparisons; accessibility/security/performance polish.
9. **Documentation/demo:** setup, diagrams, contracts, ADRs, test results, benchmark results, repeatable walkthrough.

For each phase: read requirements/ADRs, list intended changes, implement a coherent slice, run tests, report actual results and limitations, update docs, then proceed.
