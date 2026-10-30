# Phase 05 — Notifications & Alerts Flow

**Status:** Implemented and verified  
**Date:** 2026-10-30

## Scope delivered

- Added the tenant-safe `notifications` collection with user/time and source-event uniqueness indexes.
- Added authenticated notification APIs:
  - `GET /api/v1/notifications`
  - `POST /api/v1/notifications/:notificationId/read`
  - `POST /api/v1/notifications/read-all`
- Added an asynchronous outbox worker:
  - claims pending events without blocking HTTP requests
  - creates idempotent in-app notification records
  - sends verification, booking confirmation, and cancellation emails to Mailpit SMTP
  - retries failures with bounded attempts and records the last error
  - marks delivery published only after the email attempt succeeds
- Added a client notification center with unread count, polling, read-one, and read-all interactions.

## Invariants preserved

1. Notification delivery is asynchronous and never determines booking confirmation.
2. Source-event uniqueness prevents duplicate in-app notifications on worker retries.
3. Authenticated users only receive their own notification records.
4. Outbox failures are explicit and retryable; they are not silently discarded.

## Verification

- `npm test`: **123 tests passed, 0 failed**
- `npm run lint`: clean
- `npm run build --workspace=@slotify/client`: passed
