# Phase 02 — Increment 01: Password Reset (Phase 01 Completion)

**Document:** `docs/implementation-log/phase-02-increment-01-password-reset.md`
**Status:** Completed & Verified
**Date:** 2026-10-17

---

## 1. Objective

Close the Phase 01 scope gap identified in `phase-01-handoff-audit.md` §5.1: `docs/implementation-phases.md` phase 1 includes "reset", and `requestPasswordResetSchema`/`resetPasswordSchema` already existed in `@slotify/shared`, but no server implementation existed. This increment adds the password-reset endpoints before Phase 02 business work begins.

## 2. Requirements Addressed

- `docs/requirements.md`: "Email-based password reset with non-enumerating responses."
- `docs/security.md`: "cryptographically secure, single-use verification/reset tokens"; "Password-reset responses must not reveal whether an account exists."
- `docs/requirements.md` / `docs/AGENTS.md` invariants: "Invalidate sessions after sensitive account changes."

## 3. Files Changed

| File | Change |
|---|---|
| `apps/server/src/services/auth-service.js` | Added `requestPasswordReset({ email })` and `completePasswordReset({ token, newPassword })` |
| `apps/server/src/routes/auth-routes.js` | Added `POST /api/v1/auth/request-password-reset` and `POST /api/v1/auth/reset-password` |
| `apps/server/test/password-reset.test.js` | New integration test suite (5 tests) |
| `docs/implementation-log/phase-01-handoff-audit.md` | New handoff audit (created before this increment) |

## 4. Implementation

- **`requestPasswordReset`** normalizes the email, looks up the user, and **silently no-ops** (`{ sent: true }`) when the account does not exist or is suspended — the HTTP response is byte-identical either way (non-enumerating). For a valid account it generates a 32-byte random token (hashed with SHA-256 at rest, same pattern as verification), stores `passwordResetTokenHash` + `passwordResetExpiresAt` (24 hours, consistent with the verification-token expiry documented in requirements), and writes an outbox event `user.password_reset_requested` (`OutboxEventType.PASSWORD_RESET_REQUESTED` already existed in the shared contract) so actual email delivery remains asynchronous and will be handled by workers in Phase 5.
- **`completePasswordReset`** hashes the presented token, requires a matching, unexpired token, then sets the new bcrypt(12) hash, unsets the reset-token fields (making the token single-use), and calls `revokeAllUserSessions` so every active session dies on this sensitive account change.
- **Routes** follow the existing conventions: `validate()` Zod middleware, `try/catch → next(err)`, standard success envelope. The dev-only `devResetToken` exposure is guarded by `NODE_ENV !== 'production'`, mirroring `devVerificationToken` on registration.

## 5. Design Rationale

- **Token-hashed-at-rest** (SHA-256 of 32 random bytes) matches the established session/verification pattern: a database leak does not leak usable reset tokens.
- **24-hour reset expiry** matches the only expiry documented in requirements (verification links, 24 h). Shorter is possible but undocumented; not changed unilaterally.
- **Session revocation on completion** (not on request) so a reset *request* cannot be used to log someone out (minor DoS vector).
- **No transaction** across user update + session revocation: revocation is a best-effort `updateMany` and the failure mode (a session that survives until TTL) is low-risk; a transaction here would add complexity without a meaningful integrity gain. Noted as a known limitation.
- Alternative rejected: returning 404 for unknown emails (violates the non-enumeration requirement).

## 6. Architecture & Data Flow

```
POST /request-password-reset
  → Zod validate body (requestPasswordResetSchema)
  → lookup user by normalized email
    ├─ unknown/suspended → 200 { sent: true } (no DB writes)
    └─ found → set token hash + expiry → insert outbox event → 200 { sent: true, devResetToken? }

POST /reset-password
  → Zod validate body (resetPasswordSchema)
  → find user by token hash + expiry window
    ├─ no match → 400 VALIDATION_ERROR (same for invalid, expired, or reused)
    └─ match → set passwordHash, unset token fields, revoke all sessions → 200
```

## 7. API and Data Changes

- **New endpoints:** `POST /api/v1/auth/request-password-reset`, `POST /api/v1/auth/reset-password`.
- **User document fields (new):** `passwordResetTokenHash` (transient), `passwordResetExpiresAt` (transient) — both removed on successful completion. No index added (token-hash lookup is rare and bcrypt-level cost dominates; the collection scan over a small users collection is acceptable for now).
- **New outbox event:** `user.password_reset_requested` with `{ userId, email, fullName, resetToken }` payload — consumed by Phase 5 workers. No response schema changes for existing endpoints.

## 8. Security & Failure Handling

- Non-enumerating responses for unknown/suspended accounts (identical status, body shape, and message).
- Single-use token: fields are `$unset` on completion; a replayed token hits the "no match" path → 400.
- Expired tokens rejected by the `$gt: now` query condition.
- New password hashed with bcryptjs, 12 rounds (unchanged project standard).
- All sessions revoked after a successful reset (`revokedAt = now` on every open session).
- Suspended accounts cannot request a reset (prevents using reset flow on suspended accounts).

## 9. Tests (actual commands and results)

| Command | Result |
|---|---|
| `npm test --workspace=@slotify/server` | **18/18 pass** — 13 pre-existing + 5 new password-reset tests. First run had 1 failure: the test asserted the outbox event by `payload.email` alone and matched the *registration* verification event instead; fixed the test to also filter by `eventType`. No product code change needed. |
| `npm run lint` (root) | 0 errors, 0 warnings |
| **E2E (mandatory):** real server process (`node src/server.js`), full flow over HTTP | **PASS** — 1. `/health` healthy → 2. register → 3. login (session captured) → 4. request reset (dev token received) → 5. complete reset → 6. old session returns **401** (revoked) → 7. login with new password succeeds |

Note: one malformed-JSON request sent during the E2E script (a PowerShell quoting mistake) was correctly rejected by the server with HTTP 400 and logged with a correlation ID — confirming the error envelope handles body-parse failures.

## 10. Configuration

None added. Uses existing `SESSION_TTL_HOURS`, MongoDB defaults. New env vars: none. New dependencies: none.

## 11. Known Limitations

- Reset-token lookup does a collection scan (no index on `passwordResetTokenHash`); acceptable at expected scale, revisit if user counts grow.
- Outbox event for the reset confirmation is written but delivery (email) does not exist until Phase 5; local testing relies on the dev token.
- User update + session revocation are not transactional (see §5).

## 12. Debugging Guide

- **Reset always 400 on complete:** token expired (24 h), already used (fields `$unset`), or server restarted between request/complete against a different DB — check `users.passwordResetTokenHash` exists.
- **"Sent" but no outbox event:** only happens for unknown/suspended emails (silent no-op by design) — check `accountStatus`.
- **Old session still valid after reset:** check `sessions.revokedAt` is set; the TTL index only cleans up *expired* sessions, revoked ones persist until expiry by design.

## 13. Git Commit

`docs: record phase 01 handoff audit` + `feat(auth): add non-enumerating password reset with session revocation` (hashes recorded after commit).

## 14. Next Increment

**Increment 02 — Owner business CRUD:** `POST /api/v1/businesses` (draft creation for verified owners), `GET/PATCH /api/v1/businesses/:businessId` (profile, slug, hours) using `createBusinessSchema`/`updateBusinessSchema`, unique-slug conflict handling, building on `requireBusinessOwnership`.
