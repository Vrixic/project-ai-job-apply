# D1 Development Duplicate-Resolution Acceptance — 2026-08-12

## Outcome

D1-004 is complete in the synthetic development environment. The jobs schema is deployed through
`0003_duplicate_resolution_audit_guard`, gateway alias `11` uses the matching merged PR #208
artifact, and a checksum-reviewed one-task acceptance proved reversible duplicate resolution,
redacted canonical reads, provenance preservation, audit immutability, runtime health, and zero
Terraform drift.

This evidence does not authorize real provider ingestion, public UGC, real candidate data, or
production activation. The two records and their append-only review events are explicitly
synthetic operational evidence.

## Existing deployment reconciliation

Read-only inspection corrected stale delivery documentation without repeating a migration:

- CloudWatch recorded the composed migration success at `2026-08-12T02:30:36Z`:
  profile migrations through `0003_retire_legacy_dispatch`, jobs migrations through
  `0003_duplicate_resolution_audit_guard`, and all service-owned migrations verified.
- The migration task definition is revision `6`, uses the immutable development migration digest,
  has a read-only root filesystem, and its linux/amd64 image scan is complete with zero Critical
  and zero High findings.
- RDS was available, private, encrypted, deletion protected, covered by seven-day backups and
  current PITR, and the migration cluster had zero running tasks.
- Gateway alias `11` is active with no weighted routing. Its S3 artifact key is bound to merged
  source `353cf367fb912ca856fffa2d18ea580387e5b69b`, the PR #208 duplicate-resolution revision.

## Checksum-reviewed acceptance

The product owner authorized plan SHA-256
`1f72c56e48ac371e219e48c8b6177dbe2d309fb5c0144c61c1944fbe01850d01`.
The plan was reconstituted immediately before execution and matched exactly. It allowed one
Fargate task on task-definition revision `6`, the two reviewed subnets, one application security
group, no role/resource override, and one inline synthetic acceptance program. It contained no
credential or real user/provider value.

Exactly one task ran from `2026-08-12T05:14:40.958Z` to `2026-08-12T05:15:23.954Z` and exited `0`.
Its single sanitized result proved:

- one probable duplicate candidate was created from two separate synthetic records;
- exact review made the alias read resolve to one canonical record with two redacted sources;
- reopen restored both original records with one independent source each;
- two ordered audit events recorded resolution versions `1` and `2`; and
- a direct audit-event mutation failed closed with the database-enforced append-only code.

The test deliberately retains the two synthetic records and two immutable audit events as bounded
evidence. It cannot delete those events because deletion would violate the control being tested.

## Post-run acceptance

- The ECS cluster returned to zero running tasks.
- All 16 development metric alarms were determinate and non-`ALARM`.
- The acceptance window contained four aggregate log events, zero forbidden-pattern matches, and
  zero error-like matches.
- The existing runtime inspector passed API `200/200/401`, Lambda-durable dispatch, enabled
  triggers, empty ECS application runtime, temporary SSO caller, one budget, and one CUR 2.0
  export.
- The inspector initially rejected an older saved-input plan because it predated gateway alias
  `11` and migration task revision `6`. Reconstructing those exact live immutable inputs produced
  a fresh detailed-exit-code `0` plan with zero resource changes. The full inspector then passed
  with `NoDrift: true` and made no AWS mutation.

## Scope boundary

D1-004 now proves canonical identity, review-only probable matching, reversible exact resolution,
source-preserving reads, lifecycle/expiry foundations, immutable audit, and deployed recovery
health. D1-007 still owns future authenticated reports and moderation UI/API. D1-003 and D1-011
still block real sources and production data.
