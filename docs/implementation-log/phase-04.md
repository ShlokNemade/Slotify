# Phase 04 — Core Booking & Scheduling Flow

**Status:** Implemented and verified  
**Date:** 2026-10-30

## Scope delivered

- Completed the authoritative booking write path from the existing Phase 3 slot engine:
  - approved-business and active-service validation
  - service snapshots and deterministic `any` staff assignment
  - notice/horizon and availability revalidation
  - idempotent customer retries
  - deterministic concurrency winner with conflict loser cleanup
  - transactional `booking.confirmed` outbox event
- Added customer booking lifecycle APIs:
  - `GET /api/v1/bookings/my`
  - `POST /api/v1/bookings/:bookingId/cancel`
  - existing create and own-booking read APIs retained
- Added tenant-scoped owner APIs:
  - `GET /api/v1/businesses/:businessId/bookings`
  - `PATCH /api/v1/businesses/:businessId/bookings/:bookingId/status`
- Added booking indexes for tenant/status, customer time, idempotency, and segment staff/time lookups.
- Added a React + Vite client in `apps/client`:
  - public directory and business profile views
  - service/date/slot selection
  - authenticated booking confirmation
  - customer booking list and cancellation
  - responsive, token-based styling with keyboard-accessible native controls and reduced-motion support

## Invariants preserved

1. The booking write path, not client availability reads, is authoritative.
2. All booking and owner management operations remain tenant-scoped.
3. Confirmed booking and outbox event are committed together in the `rs0` transaction.
4. Cancellation and owner status changes never mutate schedule exceptions or unrelated bookings.

## Verification

- `npm test`: **123 tests passed, 0 failed**
- `npm run lint`: clean after client JSX variable handling
- `npm run lint`: clean; client development entrypoints and Vite configuration reviewed
