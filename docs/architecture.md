# System Architecture

**Target:** College Mini-Project MVP.  
**Stack:** React + Vite (Frontend), Edge Worker / Middleware (Rate Limiting), Node.js + Express (API), MongoDB `rs0` (Database), Mailpit (Local Email Sandbox).

---

## 1. System Topology

```
+-------------------------------------------------------------+
|                      React + Vite SPA                       |
|          (Customer Directory/Booking, Owner/Admin)          |
+-------------------------------------------------------------+
                               |  HTTP / JSON (Cookies)
                               v
+-------------------------------------------------------------+
|       Edge-Based Distributed Rate Limiting Middleware       |
|  - Edge Worker / Cloud Function layer                       |
|  - In-Memory KV Store                                       |
|  - Sliding-window token bucket engine                       |
|  - Periodic global sync batching                            |
+-------------------------------------------------------------+
                               |  (Passes allowlisted / unblocked traffic)
                               v
+-------------------------------------------------------------+
|                  Express API (@slotify/server)              |
|  - Auth & Sessions (bcrypt, HttpOnly cookie)                |
|  - Tenant Guard (businessId authorization)                  |
|  - Slot Engine & Schedule Expansion                         |
|  - Booking Write Service & Transaction Controller           |
+-------------------------------------------------------------+
              |                                  |
              v                                  v
+-----------------------------+    +--------------------------+
|       MongoDB (rs0)         |    |     Background Worker    |
| - Users, Sessions           |    | - Polls 'outbox' table   |
| - Businesses, Services      |--->| - Dispatches to Mailpit  |
| - Staff, Exceptions         |    | - Writes 'notifications' |
| - Bookings, Outbox, Audit   |    +--------------------------+
+-----------------------------+                  |
                                                 v
                                   +--------------------------+
                                   |      Mailpit Sandbox     |
                                   |    (Local SMTP / UI)     |
                                   +--------------------------+
```

---

## 2. Core Flows

### 2.1 Request & Rate Limiting Flow
1. Incoming client request is intercepted by the Edge Middleware.
2. Evaluates the client identity / IP using an in-memory KV store.
3. Checks token bucket capacity (burst protection) and sliding-window quota.
4. If exceeded: immediately responds with HTTP `429 Too Many Requests` + rate-limit headers.
5. If allowed: forwards request to the Express API with `X-RateLimit-*` headers attached.
6. Local counts are flushed asynchronously to the global sync batch coordinator.

### 2.2 Availability Read Path
1. Client requests slots: `GET /api/v1/directory/businesses/:slug/slots?serviceId=...&date=...`.
2. Controller fetches business hours, active staff shifts, service buffers/duration, exceptions, and existing bookings.
3. `slot-engine.js` runs pure UTC interval math:
   - Expands recurring shift & business intervals in business IANA timezone (DST-handled).
   - Subtracts exceptions and confirmed booking intervals.
   - Fits `[start, start + duration + buffer)` onto the grid.
4. Returns available start times. Reads are strictly advisory.

### 2.3 Booking Write Path (Authoritative)
1. Customer submits `POST /api/v1/bookings` with `businessId`, `serviceId`, `staffId` (or `'any'`), `startTime`, and `idempotencyKey`.
2. Auth middleware verifies customer identity and verified email status.
3. Booking service fetches current service, business, and staff records.
4. If `staffId === 'any'`, resolves to an eligible staff member free for the requested window.
5. In an atomic MongoDB multi-document transaction (`rs0`):
   - Re-queries active bookings for the target staff to guarantee zero overlap.
   - Snapshots service `name`, `duration`, `price`.
   - Inserts new booking with status `confirmed`.
   - Inserts outbox event `booking.confirmed`.
6. Transaction commits atomically. Returns 201 with confirmed booking.
7. Background worker polls outbox and sends confirmation email asynchronously.

---

## 3. Failure & Concurrency Handling

- **Double Booking Race Condition:** MongoDB transaction re-checks active booking overlap prior to insert; concurrent duplicate requests fail with 409 Conflict.
- **Worker/Email Failure:** Failure to send email never rolls back confirmed bookings. Outbox processor retries with backoff.
- **Cross-Tenant Isolation:** `requireBusinessOwnership` middleware strictly rejects cross-tenant requests with 403 Forbidden.

---

## 4. Post-Submission Components (Phase X)

- Multi-service atomic DAG scheduling chains.
- 24-hour owner booking proposal state machine.
- Chaos partition injection and dead-letter replay management.
