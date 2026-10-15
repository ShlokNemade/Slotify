# Product Requirements

**Status:** Consolidated proposal from requirements rounds 1–26.

## Product and roles
Slotify is a multi-tenant appointment platform. Independent businesses configure services, qualified staff, hours, availability, and public profiles. Customers have one reusable account across businesses. Payments are out of scope.

- **Customer:** email/password registration, email verification before booking, browse providers, book one or multiple services, manage own bookings, view notification history.
- **Owner:** one owner account per business; self-registration; email verification and platform-admin approval before publication; guided setup; manage bookings, services, staff records, customers, availability, profile, settings, analytics, and protection controls.
- **Staff:** owner-managed records; no separate login.
- **Platform admin:** separate admin area; secure local bootstrap/seed; no public admin registration; tenant approval and platform health/rate-limit monitoring.

## Accounts and sessions
- Server-managed sessions with HttpOnly cookies; revocable sessions and logout.
- Invalidate sessions after sensitive account changes.
- Verification links expire after 24 hours (proposed).
- Email-based password reset with non-enumerating responses.
- Rate-limit login, registration, verification, and reset endpoints.
- Cookie settings, CSRF protection, password hashing, token storage, and session lifetime must be specified in security design.

## Directory and public profiles
- Filter by category, location, service, date, and displayed price.
- Manual location search plus optional device location with permission.
- Sort nearest-first when location is available; otherwise relevance.
- Public profile: description, services/prices, staff display names, business hours, and bookable slots.
- Only approved, verified, complete businesses appear publicly.
- Owners can edit a unique slug; old-slug redirects/reuse behavior remains to be decided.
- No reviews in the proposed scope.
- Never expose existing appointment details, customer identities, private staff schedules, or internal abuse signals.

## Availability
- Weekly recurring business hours plus date-specific exceptions.
- Staff shifts, breaks, leave, holidays, and one-off overrides.
- Business-wide, staff-specific, and service-specific blocks.
- Warn and flag existing booking conflicts when adding blocks; never silently alter or cancel bookings.
- Business IANA time zone; store consistent timestamps (UTC is proposed); explicitly handle DST gaps/repeated times.
- Minimum advance notice and maximum booking horizon, with platform defaults and limits.
- Candidate start times follow a configured interval and are checked against service duration, buffers, staff eligibility, shifts, exceptions, and existing bookings.
- Per-service buffers can be placed before, between, or after services.

## Booking rules
- Customer chooses service order; services run sequentially and can use different qualified staff.
- For each service, customer chooses named staff or “Any available,” resolved to an actual eligible staff member.
- If only some selected services are available, explain which are unavailable and offer the available subset or another time for all. Nothing is booked until explicit confirmation.
- Atomic multi-service booking: all segments/staff assignments commit or none.
- Confirmation revalidates availability. On conflict, return refreshed options.
- Proposed statuses: `pending`, `confirmed`, `cancelled`, `completed`, `no_show`.
- Customer can cancel before appointment start; no payment-related cancellation windows, fees, deposits, or refunds.
- Rescheduling revalidates availability and applies abuse protections.
- Owner cannot directly replace a confirmed time. Owner may propose an alternative; original booking stays confirmed until customer accepts or cancels. Proposal expires after 24 hours; proposed slot is not reserved.
- Owner cancellation requires reason, notification, and audit record.
- Owner proposal rejection/expiry leaves original booking confirmed unless owner separately cancels it.
- Owner marks no-shows; elapsed time alone does not imply no-show. One no-show alone does not automatically punish the customer.
- Preserve booking history. Snapshotting service details at booking time is recommended but needs confirmation.

## Abuse controls
Business-configurable within platform limits:
- Active upcoming booking cap
- Cooldown after successful booking
- Repeated booking/cancellation-cycle threshold
- Temporary restriction duration
- Verified email required for booking
- Risk-triggered CAPTCHA/challenge
- Owners can review/lift business-specific restrictions with audit; platform admins oversee
- Temporary restrictions expire automatically; early lift requires authorization and audit
- Customer sees restriction reason/category, blocked action, and expiry when temporary
- Customer contacts owner for business-specific review
- Business restrictions do not propagate across businesses; platform-wide controls remain separate
- Shared IP alone is not proof of abuse; reschedule/cancel must remain usable during new-booking cooldown
- Example numeric thresholds discussed earlier are illustrative, not confirmed values.

## Notifications
- Email and persistent in-app notifications, with read/unread state and history.
- Local email sandbox such as Mailpit; no real emails during local development. Provider adapter for optional deployment.
- Reminders at 24 hours and 2 hours; recipients are customer and owner, not staff.
- Essential booking confirmations, cancellations, and changes are always sent; optional notifications respect preferences.
- Booking and outbox event commit together; notification delivery is asynchronous.
- Retry transient failures with backoff; exhausted events go to a dead-letter queue for inspection/replay.
- Recalculate reminders after booking changes; cancel obsolete jobs. Workers check current state and use idempotency.
- Notification failure never reverses booking confirmation.

## Dashboards
Owner sections: Calendar, Bookings, Services, Staff, Customers, Availability, Analytics, Protection, Settings.
Analytics: booking trends, cancellations, no-shows, popular services, staff utilization, abuse stats.
Admin area: platform health, tenant management, rate-limit monitoring, queue/notification health.

## High-level acceptance criteria
1. Unverified customers cannot book.
2. Unapproved/incomplete businesses are not publicly listed.
3. Customers reuse accounts across businesses.
4. Multi-service bookings are atomic.
5. Concurrent requests cannot create overlapping confirmed assignments for the same staff member.
6. Schedule blocks never silently change existing confirmed bookings.
7. Booking confirmation does not wait for email.
8. Booking changes invalidate obsolete reminders.
9. Cross-tenant access is rejected.
10. Business restrictions remain scoped.
11. Rate-limit failure behavior and overshoot are measured and documented.
12. Fault-injection tests cover crashes, partitions, lost/duplicate batches, and recovery.
