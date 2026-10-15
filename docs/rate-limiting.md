# Distributed Rate-Limiting Design

**Status:** assignment-critical proposal; correctness claims require tests.

## Goal

Implement edge middleware using token bucket plus sliding-window checks for sensitive actions, bounded token leases, periodic global sync (five seconds initially), separate tenant/customer and platform/IP namespaces, a custom abstraction over provider primitives, fault injection, and benchmarks.

## Request path

1. Classify route and risk.
2. Derive scoped key from validated identity/tenant context plus separate network/platform keys.
3. Apply local token-bucket burst protection.
4. Apply sliding-window checks to sensitive operations.
5. Consume only bounded local leases.
6. Record usage and publish batches.
7. Reconcile batches using stable IDs/sequences and idempotent ingestion.
8. Always retain authoritative backend booking validation.

## Token bucket

For capacity `B`, refill rate `r`, elapsed seconds `dt`, and previous tokens `T`:
`T_new = min(B, T + r * dt)`.
Define request costs, clock-skew assumptions, and whether a route requires more than one token.

## Sliding window

Define exact or approximate semantics, window boundaries, storage cost, timestamp assumptions, deduplication, and incorporation of batched usage. Token bucket handles bursts; it does not alone enforce a sliding-window quota.

## Leases and synchronization

- Five seconds is an initial tuning value, not a proven optimum.
- Each Worker can spend only its finite local lease.
- Lease expiry/refresh must be explicit.
- Batches need stable IDs, sequence/version, duplicate handling, retry-safe acknowledgement, and gap detection/reconciliation.
- Global usage will lag during the sync interval.
- Establish a bound for overshoot using active Worker count, lease size, partition behavior, expiry, in-flight requests, and batch loss. If unacceptable for a sensitive operation, use stronger coordination or fail closed.

## KV limitation

Cloudflare KV is eventually consistent and not a general atomic read-modify-write store. `read → increment → write` can lose concurrent updates and cannot guarantee a strict global quota. Use KV only where its semantics suffice; evaluate a scoped coordinator such as Durable Objects or an authoritative atomic operation for stronger guarantees. Verify free-tier constraints.

## Failure strategy

- Worker crash: local memory may be lost; restart conservatively and reconcile.
- Partition/coordinator outage: do not obtain unbounded new leases; enforce bounded local limits; sensitive operations may fail closed.
- Stale KV: never treat as globally current.
- Duplicate batch: deduplicate by stable ID/sequence.
- Lost batch/ack: retry idempotently and reconcile gaps.
- Clock skew: document bounds and test boundary behavior.
- Database outage: do not confirm booking.

## Abstraction

Keep policy separate from provider using small interfaces: policy/scope, lease provider, usage recorder, batch publisher/reconciler, coordination provider, and injectable clock. Avoid overengineering.

## Benchmark

Compare with a simple baseline. Measure throughput, p50/p95/p99 latency, blocked/accepted counts, coordination delay, batch lag, overshoot under normal/failure conditions, recovery time, and resource use. Include steady/burst load, many tenants, hot keys, Worker restart, partition, stale reads, batch loss/duplication, and recovery. Do not invent results before running tests.
