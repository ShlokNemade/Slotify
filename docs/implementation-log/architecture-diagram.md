# Slotify — Application Architecture Diagram

**Document:** `docs/implementation-log/architecture-diagram.md`
**Status:** As-built after Phase 05
**Rendered with:** Mermaid — paste into any Mermaid-enabled viewer (GitHub renders it natively)
**Convention:** solid arrows = implemented and verified; dashed borders/arrows = planned, not yet implemented (Phase 06+)

---

## 1. Full System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Applications (React + Vite + JSX)"]
        direction LR
        CustomerUI["Customer UI<br/>directory, profile, booking"]
        OwnerUI["Owner UI<br/>setup, catalog, calendar"]
        AdminUI["Platform Admin UI"]
    end

    subgraph Edge["Edge Layer — Cloudflare Workers + KV"]
        direction LR
        RouteClassify["Route Classification"]
        RateLimit["Token Bucket + Sliding Window<br/>+ bounded leases"]
        KV[("Cloudflare KV<br/>usage sync batches")]
        RateLimit -. "5s sync batches" .-> KV
    end

    subgraph API["Authoritative API — Node.js + Express (pure JavaScript, ESM)"]
        direction TB
        subgraph CoreMW["Middleware Chain (applied in order)"]
            Helmet["helmet"]
            CORS["cors (credentials)"]
            CookieParser["cookie-parser"]
            BodyLimit["express.json 1MB"]
            ValidateMW["validate() — Zod schemas"]
            AuthMW["authenticate — cookie/Bearer session"]
            RoleMW["requireRole / requireVerifiedEmail"]
            TenantMW["requireBusinessOwnership — tenant isolation"]
            ErrorHandler["errorHandler — envelope + correlationId"]
        end

        subgraph Routers["Route Routers (/api/v1)"]
            AuthRoutes["auth-routes<br/>register, login, logout, me,<br/>verify-email, password reset"]
            BusinessRoutes["business-routes<br/>create, read, update, submit"]
            ServiceRoutes["service-routes<br/>CRUD + deactivate"]
            StaffRoutes["staff-routes<br/>CRUD + deactivate"]
            AdminRoutes["admin-routes<br/>list, review (approve/reject)"]
            DirectoryRoutes["directory-routes<br/>public search + profile by slug"]
            BookingRoutes["booking-routes<br/>create, list, cancel, owner status"]
            NotificationRoutes["notification-routes<br/>list, read, read-all"]
            HealthRoutes["health-routes<br/>/health, /ready"]
        end

        subgraph Services["Service Layer (business logic)"]
            AuthService["auth-service<br/>bcrypt(12), SHA-256 token hashes,<br/>sessions, verification, reset"]
            BusinessService["business-service<br/>draft lifecycle, slug uniqueness,<br/>hours merge, resubmission"]
            ServiceService["service-service<br/>staff-membership validation"]
            StaffService["staff-service"]
            AdminService["admin-service<br/>bootstrapAdmin, review decisions"]
            DirectoryService["directory-service<br/>allowlist projections,<br/>completeness gating"]
            BookingService["booking-service<br/>authoritative transaction,<br/>idempotency, cancellation"]
            NotificationService["notification-service<br/>owned notification reads"]
        end
    end

    subgraph Data["MongoDB 7 — single-node replica set rs0 (transactions)"]
        direction LR
        Users[("users")]
        Sessions[("sessions<br/>TTL index")]
        Businesses[("businesses<br/>unique slug")]
        ServicesColl[("services")]
        StaffColl[("staff")]
        AuditColl[("audit_events<br/>append-only")]
        Outbox[("outbox<br/>status/attempts index")]
        Bookings[("bookings<br/>idempotency + staff/time indexes")]
        Notifications[("notifications<br/>user/read indexes")]
    end

    subgraph Async["Asynchronous Notification Pipeline (Phase 5)"]
        direction LR
        Workers["notification worker<br/>idempotent polling"]
        Mailpit["Mailpit SMTP sandbox<br/>:8025 (ready)"]
    end

    subgraph Infra["Local Infrastructure — Docker Compose"]
        Mongo["slotify-mongodb<br/>mongo:7.0, replSet rs0"]
        Rabbit["slotify-rabbitmq<br/>3.13-management"]
        Mail["slotify-mailpit"]
    end

    Clients -->|"HTTPS"| Edge
    RouteClassify --> RateLimit
    RateLimit -->|"forward"| API
    Edge -. "not implemented yet (Phase 6)" .-> RouteClassify

    AuthRoutes --> AuthService
    BusinessRoutes --> BusinessService
    ServiceRoutes --> ServiceService
    StaffRoutes --> StaffService
    AdminRoutes --> AdminService
    DirectoryRoutes --> DirectoryService
    BookingRoutes --> BookingService
    NotificationRoutes --> NotificationService

    AuthService --> Users
    AuthService --> Sessions
    AuthService --> Outbox
    BusinessService --> Businesses
    ServiceService --> ServicesColl
    ServiceService -->|"eligibility check"| StaffColl
    StaffService --> StaffColl
    AdminService --> Businesses
    AdminService --> AuditColl
    AdminService --> Outbox
    DirectoryService --> Businesses
    DirectoryService --> ServicesColl
    DirectoryService --> StaffColl
    BookingService --> Bookings
    BookingService --> Outbox
    NotificationService --> Notifications

    Outbox -->|"worker polls"| Workers
    Workers --> Mailpit
    Workers --> Notifications

    Infra --- Mongo
    Infra --- Rabbit
    Infra --- Mail
    Mongo === Data
```

## 2. Request Path Through the Middleware & Guards

```mermaid
flowchart LR
    Req["HTTP Request"] --> Helmet --> CORS --> Cookies --> Body --> Router

    subgraph GuardChains["Guard chains per route group"]
        Owner["Owner routes:<br/>authenticate → requireRole(owner)<br/>→ requireVerifiedEmail → requireBusinessOwnership"]
        Catalog["Catalog routes:<br/>authenticate → requireBusinessOwnership<br/>(mergeParams businessId)"]
        Admin["Admin routes:<br/>authenticate → requireRole(platform_admin)"]
        Public["Public routes:<br/>(none — allowlisted projections only)"]
    end

    Router --> Owner
    Router --> Catalog
    Router --> Admin
    Router --> Public

    TenantMW["requireBusinessOwnership"] -->|"admin bypass (no attachment)"| Fetch["route fetches by id"]
    TenantMW -->|"owner match"| Attach["req.business attached"]
    TenantMW -->|"owner mismatch"| E403["403 FORBIDDEN envelope"]
```

## 3. Auth & Lifecycle State Machines

```mermaid
stateDiagram-v2
    direction LR
    state "User account" as U {
        [*] --> pending_verification : register (bcrypt 12, 24h token)
        pending_verification --> active : verify-email (single-use token)
        pending_verification --> active : (stays pending if token expires)
        active --> suspended : platform action
        active --> active : password reset (revokes ALL sessions)
    }
    state "Business lifecycle" as B {
        [*] --> draft : POST /businesses (verified owner)
        draft --> pending_approval : POST .../submit
        pending_approval --> approved : admin review (audit + outbox)
        pending_approval --> rejected : admin review (notes required)
        rejected --> pending_approval : resubmit OR any owner profile edit
    }
```

## 4. Data Notes (as built)

- **Tenant isolation:** every business-owned collection row carries `businessId`; owner routes resolve through `requireBusinessOwnership`.
- **Indexes (created at boot in `db/mongo.js`):** unique user email; unique session token hash + TTL; unique business slug; services/staff by business+active; unique booking idempotency; bookings by business/status/time and customer/time; outbox processing; audit by business/time; restrictions lookup.
- **Outbox pattern:** registration/verification, password reset, admin review, booking confirmation, and booking cancellation write outbox events; the Phase 5 worker polls them, creates idempotent notifications, and sends SMTP mail.
- **Implemented:** availability engine and booking transaction (Phases 3–4), polling notification worker and client notification center (Phase 5).
- **Planned (dashed):** Edge rate limiting (Phase 6), owner/admin client portals (Phase 7), evaluation seed package (Phase 8).
