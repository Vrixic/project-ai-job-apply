# Development prelaunch shutdown

The prelaunch shutdown rule in AGENTS.md supersedes the older assumption that development runs
continuously. This procedure covers reversible traffic/trigger quiescence and disposable NAT removal.
It does not yet implement a persistent, data-preserving dormant database lifecycle.

## Preserve data while quiescing

Use the exact development SSO account, Terraform 1.16.2 and the locked, encrypted platform backend.
Capture the current state and complete applied input baseline privately. Inspect running durable
executions, ECS tasks and queue/DLQ counts before removing their network paths; drain or reconcile
unfinished work instead of discarding it. Record all counts without candidate payloads.

Keep all deployed resource flags, candidate_rights_enabled and applications_attempt_recovery_enabled
at their existing values. These flags own retained storage/queues as well as runtime configuration.
Turning candidate_rights_enabled off proposes deleting export and deletion-recovery buckets.
Never apply that change as a shutdown shortcut.

Prepare a saved, refresh-backed plan from the complete baseline:

- Set serverless_runtime_enabled=false and outbox_starts_paused=true.
- Disable document scan mapping/event/security-health rules and document tailoring invocation.
- Disable D2 runtime, policy endpoint, provider activation and provider-private-egress inputs.
- Once work is drained, set private_application_networking=false to remove the disposable NAT.
- Preserve database deletion protection, persistent_data_plane_enabled, encryption, backups,
  buckets, queues, secrets, native DNS/TLS metadata and all recovery/security resources.

The retained candidate-rights and attempt-recovery maintenance rules now follow
serverless_runtime_enabled. Candidate-rights validation permits retained resources with runtime off
and no NAT, while still requiring private egress for active operation and all existing policy inputs.

Review every plan action before applying its exact checksum. Refuse any deletion or replacement of
RDS, S3, queues, KMS, secrets or recovery data. Traffic shutdown may update Lambda environments and
numeric aliases without changing their published artifacts. Verify zero API routes, enabled
EventBridge rules, enabled queue mappings and native/ECS tasks, plus removed NAT gateways/EIPs.
Run a same-input refresh-backed plan and require zero drift.

## Remaining shutdown gap

Stopping the retained RDS instance reduces immediate compute usage but is temporary: AWS can restart
it after seven days. It does not satisfy the strict no-automatic-restart requirement. Database storage,
backups and retained private interface endpoints continue to incur charges. Do not describe this as
complete shutdown or zero cost.

The staging dormant lifecycle deletes its synthetic database and cannot be reused for development
data. A development dormant lifecycle still needs a verified backup/restore path and separate
endpoint control before permanent compute removal. Report that incomplete work and retained costs.
Keep the database protected; do not delete it merely to satisfy a shutdown report.

Before the next authorized test session, inspect current state and plan reactivation from the full
retained configuration. Do not blindly replay an old plan or remove newly adopted DNS/TLS inputs.
Start the preserved database and verify readiness before enabling routes and background work.
Repeat shutdown after the bounded test session. Verify staging separately using its own credentials;
an expired session is an explicit verification blocker, not evidence that staging is off.
