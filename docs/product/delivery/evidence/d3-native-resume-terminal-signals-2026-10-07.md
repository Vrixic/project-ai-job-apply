# D3 resume terminal failure signals - 2026-10-07

D3-064/D3-079 remain In progress. The routed durable workflow now checkpoints a scalar final
outcome and fails with a fixed error when cleanup is unresolved or attachment is not acknowledged.
It runs the existing cleanup first, including after lost attachment acknowledgement. A failed
result does not restart the original workflow or grant another generation/attachment attempt.

Preparation Terraform adds a default-off `terminal_events_enabled` switch that remains independent
of new work and runtime activation. The original function's failed, stopped and timed-out version
events feed the existing encrypted fourteen-day observation queue. The transformed notice contains
only schema version, kind, execution ARN, function ARN and status. Rules use the original function
prefix with a colon boundary to retain coverage for its old numeric versions. Original queue/KMS
policies admit that exact rule; delivery retries are bounded to 24 hours/185 attempts.

Existing queue alarms are joined by terminal-delivery, durable-failure and durable-timeout alarms.
Execution metrics provide an independent signal when events are missed, not automatic ledger
reconciliation. [AWS documents these execution events and metrics](https://docs.aws.amazon.com/en_en/lambda/latest/dg/durable-monitoring.html).
The [operator runbook](../../../../infrastructure/runbooks/observability/native-resume-terminal-recovery.md)
requires original identity/status confirmation, protected checkpoint inspection and conservative
handling of missing acknowledgements. It does not create an automatic consumer or a new mutation
permission. Checkpoints retain seven days, shorter than queue retention: investigate promptly.

## Local verification

- Workflows TypeScript build and focused Biome checks pass.
- 26 actual-SDK workflow/lifecycle tests pass with simulated owner/AWS calls, including lost
  delete and attachment acknowledgements becoming terminal failures after cleanup.
- Eight emitted bundle/isolation checks pass.
- Seventeen preparation-module and two platform failure-retention mocked Terraform tests pass.
  A test map/object equality mismatch was corrected without changing runtime configuration.
- Both development and staging Terraform configurations validate.

No managed event delivery, queue encryption, alert receipt, operator recovery drill, cloud
publication or deployment is claimed. No full verifier or fresh audit; previous dependency
findings remain open. Nothing is enabled. Docker/WSL remain off; PC remains on.

## Remaining gates

Missed-event ledger reconciliation and automated original-effect recovery are not implemented by
this change. The operator procedure still requires a managed synthetic drill and accountable
ownership before activation. Hostname/zone, matching TLS/ingress, immutable release and managed
download acceptance remain. ADR-040 stays Proposed; D1 and D3 are incomplete. CI/CD deferred.
