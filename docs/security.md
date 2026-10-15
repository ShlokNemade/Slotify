# Security and Authentication

**Status:** proposed; perform threat-model review.

## Authentication
- Server-managed sessions with HttpOnly cookies and revocation.
- Use Secure cookies over HTTPS and a carefully chosen SameSite policy.
- HttpOnly does not prevent CSRF. Add CSRF protection and appropriate Origin checks.
- Rotate session IDs on login/privilege changes; invalidate sessions after sensitive account changes.
- Modern password hashing; cryptographically secure, single-use verification/reset tokens; 24-hour verification expiry.
- Password-reset responses must not reveal whether an account exists.
- Rate-limit login, registration, verification, and reset endpoints.

## Authorization
- Backend authorization on every protected request.
- Owners access only their business data; customers access only their own bookings.
- Platform-admin permissions are bootstrapped securely, never via public registration or client-controlled fields.
- Public endpoints return allowlisted published data.
- Staff have no login in the proposed scope.

## Abuse/privacy
- Edge request limits, account/business policy checks, and authoritative booking validation are separate layers.
- Shared IP alone is not proof of abuse.
- Do not expose risk scores, exact detection signals, private appointments, customer identity, or internal staff schedules.
- Minimize IP/device data, document retention, and restrict access to abuse/audit records.
- Challenge/CAPTCHA should have a provider adapter and local/test mode.

## Application security
Validate inputs, encode outputs, use strict schemas and parameterized database operations, configure CORS/request limits, and test CSRF, XSS, brute force, and object-level authorization. Keep secrets out of source control and redact passwords, cookies, tokens, and sensitive payloads from logs.

## Audit
Record owner cancellations/adjustments and reasons, reschedule/proposal decisions, restriction creation/expiry/lift, protection setting changes, tenant approval, admin actions, and dead-letter replay. Preserve history rather than deleting lifted restrictions.
