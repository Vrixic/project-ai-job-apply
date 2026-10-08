# Development prelaunch shutdown

The prelaunch shutdown rule in AGENTS.md supersedes the older assumption that development runs
continuously. This procedure covers reversible traffic/trigger quiescence and disposable NAT/interface-endpoint removal.
Complete the data-preserving [database dormancy lifecycle](development-database-dormancy.md) afterward; a temporary RDS stop is not completion.

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
- After quiescence and verified drain, separately set private_service_endpoints_enabled=false.
  Its reviewed plan must delete only the seven interface endpoints. Retain the gateway endpoints
  and security/policy resources. The flag defaults true and refuses active-runtime removal.
  Restore these endpoints before starting any subsequent database, migration or native-task test.

The retained candidate-rights and attempt-recovery maintenance rules now follow
serverless_runtime_enabled. Candidate-rights validation permits retained resources with runtime off
and no NAT, while still requiring private egress for active operation and all existing policy inputs.

Review every plan action before applying its exact checksum. Refuse any deletion or replacement of
RDS, S3, queues, KMS, secrets or recovery data. Traffic shutdown may update Lambda environments and
numeric aliases without changing their published artifacts. Verify zero API routes, enabled
EventBridge rules, enabled queue mappings and native/ECS tasks, plus removed NAT gateways/EIPs.
Run a same-input refresh-backed plan and require zero drift.

## Database dormancy and retained costs

Stopping the retained RDS instance reduces immediate compute usage but is temporary: AWS can restart
it after seven days. It does not satisfy the strict no-automatic-restart requirement. Database storage,
backups and any interface endpoints not yet removed continue to incur charges. Do not describe this as
complete shutdown or zero cost.

The staging dormant lifecycle deletes its synthetic database and cannot be reused for development
data. Use the dedicated development database lifecycle with an available encrypted safety snapshot, a
verified private restore, and a separately reviewed final-snapshot deletion plan. Preserve all data
and report retained snapshot/storage costs. Until those checks pass, keep the database protected
and report shutdown incomplete.

Before the next authorized test session, inspect current state and plan reactivation from the full
retained configuration. Do not blindly replay an old plan or remove newly adopted DNS/TLS inputs.
If dormant, restore the exact retained snapshot through the database lifecycle and verify readiness
before enabling routes and background work. A temporary stopped instance can instead be started.
Repeat shutdown after the bounded test session. Verify staging separately using its own credentials;
an expired session is an explicit verification blocker, not evidence that staging is off.
