# Security and Authentication Specification

Compact security policies enforced across all application layers.

## 1. Authentication & Session Management

- **Sessions:** 32-byte cryptographically random session tokens, stored as SHA-256 hashes in MongoDB with TTL auto-expiry.
- **Cookies:** Transported via `HttpOnly`, `SameSite=Lax` cookies (or `Authorization: Bearer` header).
- **Password Hashing:** `bcryptjs` with 12 salt rounds.
- **Verification Tokens:** Cryptographically random, single-use, 24-hour expiration.
- **Password Reset:** Non-enumerating responses (identical message whether email exists or not).
- **Session Revocation:** All user sessions revoked upon password reset or role mutation.

## 2. Authorization & Tenant Isolation

- **Role Verification:** Middleware guards verify `customer`, `owner`, or `admin` on protected routes.
- **Tenant Guard (`requireBusinessOwnership`):** Enforces that the authenticated owner owns the target `businessId`. Cross-tenant requests return 403 Forbidden.
- **Admin Bypass:** Platform admin CLI-bootstrapped identity can review any business.
- **Public Data Masking:** Directory endpoints expose allowlisted public data only (no private appointments, customer PII, or internal staff shifts).

## 3. Input Validation & Data Protection

- **Schema Validation:** Strict Zod parsing on `req.body`, `req.query`, and `req.params`. Extra fields stripped.
- **No Secrets in Repo:** All credentials pulled from environment variables (`.env.example` template).
- **Sensitive Log Redaction:** Passwords, session tokens, and reset tokens never written to application logs.
- **Error Sanitization:** Centralized error envelope returns consistent sanitized errors with correlation IDs.
