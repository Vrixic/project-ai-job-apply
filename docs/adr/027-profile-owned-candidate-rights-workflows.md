# ADR-027: Profile-Owned Candidate Rights Workflows

Status: Proposed
Date: 2026-08-25

## Context

Phase 1 already lets a candidate correct confirmed profile facts, but real-candidate onboarding is
blocked because portable export and irreversible account deletion are not implemented end to end.
The affected records span Profile, Documents, Jobs reporting, Matching, Billing, encrypted S3
objects, managed identity, operational caches, and backups. Deleting only the Profile row or
returning a synchronous database dump would violate service ownership, omit external copies, and
allow a partial failure or restore to resurrect candidate data.

Export format lifetime, active/audit retention, backup aging, rights-request timing, and any lawful
exclusions remain accountable product, security/privacy, and counsel decisions. Engineering must be
able to implement and test the mechanism without silently turning provisional values into policy.

## Decision

Profile owns the candidate-rights request, state machine, operation projection, minimal audit, and
cross-owner orchestration. Each data owner owns its export projection and idempotent deletion
activity. No module reads or deletes another module's tables directly.

- Candidate-rights routes require `profile:write`, an exact owner resolved from the OIDC principal,
  and a recent authentication claim produced by the managed identity boundary. Account-deletion
  confirmation additionally requires an MFA authentication method. Missing, future-dated, or stale
  claims fail closed.
- Export and deletion requests are externally visible commands with bounded idempotency keys. The
  accepted transaction writes the request, operation, identifier-only outbox event, and value-free
  audit record atomically.
- Durable workflows receive only internal identifiers, policy version, and correlation metadata.
  Candidate values, identity-provider subjects, object keys, tokens, and exported content never
  enter events, queues, workflow input/history, or general logs.
- Each owner returns a versioned allowlisted export section. The builder validates the complete
  section inventory, produces canonical UTF-8 JSON, encrypts one exact private object with the
  candidate-rights KMS key, and records only its object/version/digest metadata. Raw resume and
  normalized-document bytes are excluded; document metadata and candidate-confirmed facts are
  included. Credentials, session material, OAuth tokens, restricted secrets, and internal
  idempotency payloads are never exported.
- Export download uses an exact-object, short-lived, single-owner grant. Access is audited without
  retaining the URL or payload. Expiry schedules exact-version object deletion and the resource
  cannot return to `ready` afterward.
- Account deletion is a separate request and confirmation. Confirmation atomically quarantines the
  account before emitting work: ordinary reads/login resolution, new workflows, and external effects
  fail closed. Cancellation is permitted only before confirmation.
- The deletion workflow revokes managed identity and delegated credentials, deletes exact document
  object versions, invokes every current D1 owner's idempotent deletion activity, reconciles caches
  and subprocessors, and only then removes the active identity row. Partial progress remains
  quarantined and retryable; it never restores ordinary access.
- A separate deletion ledger retains an encrypted replay locator only through the configured backup
  window plus a minimal value-free completion proof. Any restored database must replay that ledger
  before serving. `backup_expired` is recorded only after both the configured window and a backup
  inventory check prove no restorable copy remains; the encrypted locator is then destroyed.
- Export expiry, retention, backup aging, recent-authentication age, response timing, provider
  inventory, and policy version are required deployment configuration. There are no activation
  defaults. Terraform and runtime validation refuse candidate-rights activation while any value or
  accountable policy digest is absent.

The implementation path is:

```text
settings UI -> same-origin BFF -> authenticated gateway -> Profile rights transaction/outbox
  -> versioned durable workflow -> owner-specific activities -> operation/resource result
```

## Consequences

- Cross-owner work can be retried and audited without weakening table ownership or spreading PII
  through orchestration infrastructure.
- Confirmed deletion is intentionally unavailable during a partial outage because fail-open erasure
  would create resurrection and orphaning risks.
- The gateway and managed identity configuration must project and validate recent-authentication and
  MFA claims before the confirmation route can be enabled.
- New owner modules and subprocessors must add export and deletion capabilities to the versioned
  inventory before they may process real candidate data.
- Development can use generated-synthetic policy values and identities for verification, but that
  evidence cannot approve public durations, real-user identity deletion, or production activation.

## Alternatives

- **Delete `identity.users` and rely on cascades.** Rejected because several owners deliberately do
  not use cross-schema foreign keys, external objects/providers would remain, append-only guards
  would conflict, and restore replay would be absent.
- **Return a synchronous API JSON dump.** Rejected because it cannot safely bound all owners,
  external reconciliation, encrypted artifact lifetime, or retries.
- **Let one rights repository query every schema.** Rejected because it breaks ADR-003 ownership and
  makes future owner additions invisible.
- **Hard-code provisional retention and expiry values.** Rejected because configuration is not
  accountable policy approval and the values affect irreversible user rights.
