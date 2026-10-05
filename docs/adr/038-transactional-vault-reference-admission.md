# ADR-038: Transactional vault reference admission

- Status: Proposed; synthetic engineering implementation only, accountable activation review pending
- Date: 2026-10-04

## Context

ADR-010 requires correction/deletion to prevent queued use of a superseded answer. A point-in-time reference read before an Applications row lock cannot prove the answer remains current when admission commits. A separate Profile transaction holding a lock can lose its lock independently of the Applications transaction.

## Decision

Profile exposes a private bounded metadata admission capability accepting only a transaction-scoped tagged query function. Profile owns the fixed SQL and obtains the exact advisory transaction locks already used by save, remove and removeByField, in sorted order. It rereads exact latest active owner/field/context/version receipts after obtaining every lock. No plaintext or KMS operation occurs inside admission. The caller's Applications transaction owns these locks through commit or rollback, alongside approval, attempt dispatch or preparation state changes. Missing capability and transport errors fail closed.

Value preparation remains an exact selected read outside SQL locks, followed by mandatory candidate review and immutable packet hashing. Expiry is checked again with an admission clock after metadata locking. No metadata receipt authorizes a provider effect after later changes; future executing adapters still require their approved fresh-destination and final-action controls.

## Consequences

The capability adds no public route, general listing, writable Profile API or new grants. All vault writers must preserve their shared lock protocol. Deployment review must verify exact SQL privileges, runtime composition and schema/migration order. This decision does not certify privacy writer drain, provider quiescence, legal approval or full candidate deletion. The feature remains default-off pending the remaining D3 gates.
