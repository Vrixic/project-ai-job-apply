# Profile Migrations

Reviewed forward PostgreSQL migrations for identity, profile, operations, outbox, idempotency, and
audit state. Migrations must preserve ownership and be tested against representative data.

Provider retirement migrations must fail before mutation when undispatched work remains.
Historical published routing values may be normalized only to a provider-neutral retired label;
operation, audit, idempotency, and user-owned data remain unchanged.
