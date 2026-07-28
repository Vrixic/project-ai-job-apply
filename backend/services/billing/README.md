# Billing Service

Owns the normalized Free/Pro subscription state, receipts, provider webhooks, paid-through dates, grace periods, reconciliation, and internal feature entitlements.

## Planned subfolders

- `subscriptions/` — Provider-neutral subscription lifecycle.
- `entitlements/` — Fast internal feature-access decisions.
- `providers/` — Stripe, StoreKit, and Google Play adapters.
- `webhooks/` — Signed, idempotent event processing.
- `reconciliation/` — Scheduled provider/internal consistency checks.
- `support/` — Audited refunds and entitlement adjustments.
- `tests/` — Renewal, cancellation, grace, replay, and outage tests.

Feature code checks internal entitlements rather than depending directly on a payment provider.
