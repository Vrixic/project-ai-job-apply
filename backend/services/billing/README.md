# Billing Service

Owns provider-neutral Free/Pro entitlement truth, exact access and grace schedules, immutable change
history, command replay receipts, and the identifier-only entitlement-change outbox. Billing
identifiers and schedules are Confidential. Feature code depends on the `EntitlementAuthorizer`
port and stable capability keys, never on a payment-provider payload or plan string.

## Current source boundary

- `src/evaluator.ts` evaluates exact schedule boundaries and fails closed for invalid clocks or
  schedules.
- `src/cache.ts` provides a bounded in-process LRU. Fresh entries live for at most 60 seconds and
  never cross the next schedule boundary. A stale Pro entry is usable during a database outage
  only from its effective time through its exact access or grace end; stale Free, future Pro, and
  unknown users fail unavailable.
- `src/store.ts` reads absent accounts as canonical Free/version zero without writing. Internal
  changes use a per-user transaction lock, expected-version compare-and-swap, exact request-hash
  idempotency, one account update, one append-only audit record, and one identifier-only outbox
  event in the same transaction. Outbox leases permit at most five delivery attempts; an explicit
  fifth failure or an expired fifth lease becomes a terminal failed record instead of an unbounded
  retry loop. Its readiness probe binds the exact current migration checksum and all five required
  Billing relations rather than treating a generic database connection as schema readiness.
- `migrations/0001_entitlement_projection.sql` owns only opaque internal UUIDs and normalized
  schedules. It stores no provider, customer, price, currency, interval, payment method, tax,
  receipt, or storefront data.

Both Free and Pro currently grant the same four already-planned core capability keys; there are no
paid-only features, quotas, prices, trials, or checkout links in this packet. A reserved audited
support-adjustment reason exists, but there is no support caller, API, UI, or activated workflow.
The v1 single-row projection binds new commands to a trusted clock, rejects future-effective or
backdated mutations, and preserves exact historical idempotency replay before chronology checks,
so a scheduled replacement cannot erase an active schedule before its boundary. Scheduled
transitions require a later history model.
No public mutation or provider adapter exists. The source composition appends Billing to the
reviewed migration runner and five-owner restore manifest. `GET /v1/entitlements` resolves the
authenticated Profile identity to an internal UUID and returns only a derived provider-neutral
status through a bounded warm-process cache; Billing never receives the issuer, subject, email, or
an owner identifier from client input. This source does not publish an image, add a cloud route or
permission, deploy, or establish generated-synthetic acceptance.

The outbox boundary persists and leases identifier-only records and terminalizes poison records;
it does not include a network publisher, failed-row reconciliation/replay tooling, an external
queue or dead-letter queue, or an activated delivery schedule.

Actual Stripe, StoreKit, and Google Play adapters; signed webhooks; receipts; cancellation;
reconciliation; support-adjustment activation; pricing; paid gating; financial retention; and real
billing data remain later D6 and accountable legal/security gates. Account deletion/detachment and
financial-record retention are intentionally unresolved here, so this source packet must not hold
real billing data.
