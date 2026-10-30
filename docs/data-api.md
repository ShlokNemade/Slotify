# Data Model and API Contracts

**Target:** College Mini-Project MVP.  
**Format:** Machine-readable entity specifications, indexes, and API routes.

---

## 1. MongoDB Collections & Indexes

| Collection | Schema / Entity | Key Indexes |
|---|---|---|
| `users` | User credentials & profile | `{ email: 1 }` (unique, lowercase) |
| `sessions` | Active sessions | `{ tokenHash: 1 }` (unique), `{ expiresAt: 1 }` (TTL) |
| `businesses` | Business profile & hours | `{ slug: 1 }` (unique), `{ ownerId: 1 }`, `{ status: 1 }` |
| `services` | Offered services | `{ businessId: 1, active: 1 }` |
| `staff` | Staff members & shifts | `{ businessId: 1, active: 1 }` |
| `availability_exceptions` | Closures & blocked times | `{ businessId: 1, date: 1 }`, `{ businessId: 1, staffId: 1 }`, `{ businessId: 1, serviceId: 1 }` |
| `bookings` | Customer appointments | `{ businessId: 1, status: 1 }`, `{ customerId: 1 }`, `{ 'segments.staffId': 1, 'segments.startTime': 1 }`, `{ businessId: 1, idempotencyKey: 1 }` |
| `outbox` | Async event dispatch | `{ status: 1, nextAttemptAt: 1 }` |
| `notifications` | In-app user notifications | `{ userId: 1, createdAt: -1 }`, `{ userId: 1, sourceEventId: 1 }` (unique) |
| `audit_events` | Immutable security log | `{ targetId: 1, timestamp: -1 }` |

---

## 2. Core Entity Shapes

```json
// Booking Document
{
  "_id": "ObjectId",
  "businessId": "ObjectId",
  "customerId": "ObjectId",
  "status": "confirmed | cancelled | completed | no_show",
  "totalPrice": 50.00,
  "currency": "USD",
  "segments": [
    {
      "staffId": "ObjectId",
      "service": {
        "serviceId": "ObjectId",
        "name": "Haircut",
        "durationMinutes": 45,
        "bufferMinutes": 15,
        "bufferPlacement": "after",
        "price": 50.00
      },
      "startTime": "2026-11-02T14:00:00.000Z",
      "endTime": "2026-11-02T14:45:00.000Z"
    }
  ],
  "idempotencyKey": "string",
  "cancellationReason": "string (optional)",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

---

## 3. API Route Registry

### 3.1 Authentication (`/api/v1/auth`)
| Method | Path | Auth Guard | Body / Params | Returns |
|---|---|---|---|---|
| `POST` | `/register` | None | `{ email, password, role }` | 201 `{ user }` |
| `POST` | `/login` | None | `{ email, password }` | 200 `{ user }` + Cookie |
| `POST` | `/logout` | Authenticated | None | 200 `{ success: true }` |
| `GET` | `/me` | Authenticated | None | 200 `{ user }` |
| `POST` | `/verify-email` | None | `{ token }` | 200 `{ success: true }` |
| `POST` | `/request-password-reset` | None | `{ email }` | 200 `{ success: true }` |
| `POST` | `/reset-password` | None | `{ token, newPassword }` | 200 `{ success: true }` |

### 3.2 Directory & Availability (`/api/v1/directory`)
| Method | Path | Auth Guard | Query Params | Returns |
|---|---|---|---|---|
| `GET` | `/businesses` | Public | `category, city, country, search, minPrice, maxPrice, page, limit` | 200 `{ businesses, total, page }` |
| `GET` | `/businesses/:slug` | Public | None | 200 `{ business, services }` |
| `GET` | `/businesses/:slug/slots` | Public | `serviceId, date (YYYY-MM-DD)` | 200 `{ slots: ["ISO"] }` |

### 3.3 Owner Business Management (`/api/v1/businesses`)
| Method | Path | Auth Guard | Description |
|---|---|---|---|
| `POST` | `/` | Verified Owner | Create draft business profile |
| `GET`, `PATCH`| `/:businessId` | Business Owner | View/update business details & weekly hours |
| `POST` | `/:businessId/submit` | Business Owner | Submit profile for admin approval |
| `CRUD` | `/:businessId/services[/:serviceId]` | Business Owner | Manage tenant services |
| `CRUD` | `/:businessId/staff[/:staffId]` | Business Owner | Manage tenant staff & weekly shifts |
| `CRUD` | `/:businessId/exceptions[/:exceptionId]` | Business Owner | Manage schedule closure & block windows |
| `GET` | `/:businessId/availability` | Business Owner | Preview calculated slots with staff details |
| `GET` | `/:businessId/bookings` | Business Owner | Query tenant bookings |
| `PATCH` | `/:businessId/bookings/:bookingId/status` | Business Owner | Update status (`completed`, `no_show`) |

### 3.4 Customer Bookings (`/api/v1/bookings`)
| Method | Path | Auth Guard | Description |
|---|---|---|---|
| `POST` | `/` | Verified Customer | Create single-service booking atomically (201) |
| `GET` | `/my` | Authenticated | List current user's bookings (200) |
| `POST` | `/:bookingId/cancel` | Booking Customer | Cancel booking prior to start time (200) |

### 3.5 Platform Admin (`/api/v1/admin`)
| Method | Path | Auth Guard | Description |
|---|---|---|---|
| `GET` | `/businesses` | Admin | List businesses by status (`pending_approval`, etc.) |
| `POST` | `/businesses/:businessId/review` | Admin | Review business (`approved` / `rejected` with notes) |

### 3.6 Notifications (`/api/v1/notifications`)
| Method | Path | Auth Guard | Description |
|---|---|---|---|
| `GET` | `/` | Authenticated | List the current user's notifications and unread count |
| `POST` | `/:notificationId/read` | Authenticated | Mark one owned notification as read |
| `POST` | `/read-all` | Authenticated | Mark all current-user notifications as read |
