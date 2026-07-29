# ADR-003: PostgreSQL Ownership and PII

Status: Accepted
Date: 2026-07-28

## Decision

Use PostgreSQL as transactional truth with module-owned schemas, Drizzle types, and reviewed SQL
migrations. Separate identity, profile, and platform operational tables. Use internal UUIDv7 IDs,
TLS, KMS encryption, encrypted backups, owner-scoped queries, and secrets-manager credentials.
Candidate values do not enter logs, general events, fixtures, or analytics.

## Consequences

Advanced PostgreSQL constraints and migrations remain explicit. Cross-module joins occur only in
owned read models or APIs, never through undocumented table access.
