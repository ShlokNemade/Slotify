# Open Questions and Validation Checklist

Avoid restarting broad preference rounds. Resolve only material correctness/security/feasibility gaps; document sensible defaults for minor details.

## High priority
1. **Booking concurrency:** choose and prove how overlapping confirmed assignments are prevented. MongoDB transactions alone are not assumed sufficient for arbitrary interval overlap. Test concurrent writes.
2. **Stronger edge coordination:** evaluate Durable Objects or another coordinator for scopes where KV is insufficient; verify quotas and local simulation.
3. **Rate-limit overshoot:** define lease size, active Worker assumptions, expiry, partition behavior, and in-flight requests; derive or measure bounds.
4. **MongoDB local topology:** specify replica-set/container setup required for transactions.
5. **RabbitMQ topology:** define durable queues, publisher confirms, retries/backoff, dead-letter retention, poison messages, replay authorization.
6. **Owner proposals:** recommended default is one active proposal per booking; confirm if multiple are needed.
7. **Automatic completion:** manual completion is the safer default; optional automation remains undecided.
8. **Service snapshot:** confirm snapshotting name/duration/displayed price at booking time.
9. **Slug history:** define old-slug redirect retention and reuse; recommended default is redirect and do not immediately reuse.
10. **Notification preferences:** define optional categories and whether channel preferences are independent.
11. **Identity roles:** clarify whether one email identity may also own a business while being a customer; customer identity remains global across businesses.
12. **Business approval:** define rejection reasons, resubmission, and re-review.
13. **CAPTCHA provider:** choose only if needed; retain adapter and local test mode.

## Values to measure or confirm
- Numeric rate-limit defaults and platform maxima.
- Booking horizon/minimum-notice defaults.
- Benchmark thresholds after baseline run.
- Notification retry/backoff schedule and dead-letter retention.
- Audit and telemetry retention.
- Free-tier quotas/provider limits at implementation time.

## Fixed constraints to preserve
No payments; global customer accounts; no staff login; booking confirmation independent of notifications; atomic multi-service booking; no silent changes to confirmed bookings; business-specific restrictions do not automatically propagate; shared IP alone is not proof of abuse; rate limiting is not booking concurrency control; local demo needs no paid service.
