# D1 development PostgreSQL recovery acceptance — 2026-08-25

## Outcome

The current D1 synthetic development database completed one isolated latest-point-in-time recovery
exercise. The private disposable copy matched the source's exact aggregate verification digest and
was deleted with all derivative restore artifacts. The source database and application routing were
not changed.

This evidence closes the D1 PostgreSQL create/verify/cleanup exercise only. It does not establish a
production recovery objective, row-value inspection, production-data authorization, Multi-AZ
behavior, or a five-minute RPO/60-minute RTO commitment.

## Aggregate verification

- Restore verifier manifest: `d1-profile-jobs-public-documents-matching-billing-v1`.
- Manifest SHA-256: `39c3a3f181f91231dc1607bd94edb31d0d29e37911f19ff6de2e973187eeec1f`.
- Owners: `5`.
- Relations: `42`.
- Migration entries: `20`.
- Source/target aggregate digest match: `true`.
- Verifier log events: `1`.
- Forbidden log matches: `0`.
- Functional recovery measurement: `3,281` seconds from the accepted restore attempt through the
  successful target verifier.

The operator did not retain individual relation counts, row values, endpoints, database URLs,
credentials, account/resource identifiers, or raw CloudWatch events.

## Operator corrections encountered

The first start stopped before any restore request because the ECS response omitted the optional
`logStreamName` field. Exact source `cc3c331` now accepts omission while rejecting a conflicting
reported value and still requires the deterministic encrypted stream and valid aggregate event.

The next start stopped locally before any AWS API request because the installed RDS CLI model no
longer accepts `EnablePerformanceInsights` in the PITR request. The source setting was disabled;
exact source `4896765` removed only that obsolete request member and the complete current request
then passed CLI model validation.

The accepted restore reached `available`, but its metadata needed longer than the initial
post-availability convergence allowance. Exact sources `37de6d7`, `f6ce937`, and `5bac6b4` added
field-only/value-free tag diagnostics and fixed locale-dependent AWS ISO timestamp parsing. The
resumable verifier then authenticated the same target and passed without a second restore request.

PowerShell 7 and Windows PowerShell 5.1 restore guard suites passed after each correction. No
failed attempt left an untracked target: the pre-network rejected context was removed only after
zero-target confirmation, and the accepted target remained bound to its retained context through
verification and cleanup.

## Cleanup and final state

- Target deleted: `true`.
- Remaining disposable restore targets: `0`.
- Remaining target snapshots: `0`.
- Remaining target automated backups: `0`.
- Source available: `true`.
- ECS runtime idle: `true`.
- Managed runtime alarms `OK`: `44`.
- Terraform drift: `0`.
- Local restore context removed: `true`.

No Docker or WSL runtime was required for this exercise.
