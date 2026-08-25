# Billing migrations

`0001_entitlement_projection.sql` creates the Billing-owned provider-neutral entitlement account,
append-only change history, immutable event payload outbox, and idempotent command receipt tables.
It stores opaque internal UUIDs and schedules classified as Confidential; it stores no provider,
price, payment method, receipt, tax, or storefront payload.

`0002_candidate_rights.sql` exports provider-neutral entitlement state and permits removal of the
candidate's otherwise append-only history only inside a privacy-ledger-authorized account deletion.

Apply migrations only through the checksum-verifying Billing runner. The source packet is
generated-synthetic and does not activate payments, paid gating, provider adapters, or support
adjustments.
