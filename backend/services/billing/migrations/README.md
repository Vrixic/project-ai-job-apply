# Billing migrations

`0001_entitlement_projection.sql` creates the Billing-owned provider-neutral entitlement account,
append-only change history, immutable event payload outbox, and idempotent command receipt tables.
It stores opaque internal UUIDs and schedules classified as Confidential; it stores no provider,
price, payment method, receipt, tax, or storefront payload.

Apply migrations only through the checksum-verifying Billing runner. The source packet is
generated-synthetic and does not activate payments, paid gating, provider adapters, or support
adjustments.
