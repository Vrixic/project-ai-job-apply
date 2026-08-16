# Synthetic ingestion dark release

This runbook describes source review for the D1 generated-synthetic durable ingestion data plane.
It does not authorize AWS mutation or activation.

## Invariants

- The reviewed migration composition is exactly 5 owners, 39 regular relations, and 14 migrations.
- Only `synthetic-foundation-v1`, provider `other`, provenance `authorized_fixture`, and `.example.test`
  generated observations exist in the runtime artifact.
- `deploy_ingestion_runtime`, `ingestion_runtime_enabled`, and
  `ingestion_synthetic_source_enabled` are ordered gates and default false; the shared
  `runtime_activation_allowed` lifecycle authority must also permit any ingestion trigger.
- The dispatch queue mapping, five-minute reconciliation rule, and terminal rule remain disabled
  until an approved activation record exists. The coordinator derives one idempotent occurrence
  per canonical UTC hour, so reconciliation cadence does not multiply source polling. An exact
  at-least-once schedule replay authenticates immutable occurrence and generation-one runtime
  function families, then returns the progressed checkpoint and its already-frozen numeric
  versions/configuration without creating rows. A recovery-generation
  exhausted replay deliberately remains a fixed failure signal for that occurrence; later hours
  remain independent.
- The main dispatch queue retains identifier-only nudges for 4 days. The shared DLQ retains
  value-free schedule envelopes, terminal metadata envelopes, durable identifier-only inputs, and
  failed nudges for 14 days. Neither queue contains job descriptions, source URLs, candidate data,
  or raw errors. Nothing automatically consumes or redrives the mixed DLQ: an operator must first
  classify an entry by its exact envelope and authenticate it against Jobs dispatch truth.
- Redacted durable execution history is retained for exactly 30 days, matching the reviewed
  detailed-workflow-log policy; this is distinct from queue retention and Jobs audit rows.
- Each generation freezes its durable-function version, activity-function version, adapter
  version, and generated-synthetic configuration digest. The narrowly scoped function-family IAM
  grants let already-persisted numeric versions finish or restart after a release; runtime checks
  reject aliases, `$LATEST`, another function family, and configuration drift.
- An hourly coordinator pass retries an ambiguous nudge with the same dispatch and durable
  execution name after one hour; five publish attempts produce the durable
  `TransportRecoveryExhausted` refusal instead of inventing a new generation. For a started
  dispatch older than two hours it calls Lambda
  `GetDurableExecution` with `IncludeExecutionData=false`; `RUNNING` stays unchanged, while an exact
  terminal metadata response is persisted before any next generation. Not-found, throttled,
  malformed, or failed reads refuse that reconciliation. Generations are capped at 20 with an exact
  `recovery_exhausted` dispatch plus a distinct checkpoint `exhaustedDispatchId`; no attempt lease
  or settlement is fabricated. Replaying that occurrence remains terminal while a later canonical
  hour is independent. An unresolved transport-start ambiguity remains a visible coordinator
  failure until exact late terminal metadata arrives; this packet has no automatic or operator
  mutation that silently clears it. Checkpoint attempt/lease/revision fencing rejects stale work.
  This is bounded source recovery, not proof of deployed EventBridge delivery.

- The source packet defines alerts for dispatch age/DLQ depth, every ingestion Lambda error and
  throttle, durable failure/timeout, and durable execution duration at 90% of the configured
  timeout. `ApproximateRunningDurableExecutionsUtilization` is an account-quota metric rather than
  an exact ingestion-function dimension, so this packet does not claim a source-specific
  utilization alarm; review the account-level metric separately before activation.

- An adapter-version rollout changes occurrence identity. Disable the source gate before changing
  adapter version or generated configuration, keep it disabled through the current UTC-hour
  boundary, and re-enable only under a new activation record; this packet does not claim live
  mid-hour adapter/config rollout safety.

## Source verification

1. Build both immutable ingestion Lambda archives and record each SHA-256, S3 version, file count,
   handler export, and dependency audit receipt.
2. Run the Jobs migration and ingestion integration suite against an isolated PostgreSQL 16
   database. Prove exact replay, competing revision refusal, append-only events, dispatch reclaim,
   bounded recovery, and cleanup of only the generated fixture.
3. Review a saved Terraform plan. The first approved plan may set only
   `deploy_ingestion_runtime=true`; both enable switches must remain false.
4. Confirm the resulting aliases reference exact numeric versions, each transport Lambda has its
   own least-privilege role, both rules and the SQS mapping are disabled, EventBridge and durable
   state use exact platform-CMK grants, and queue retention is 4/14 days.

## Stop conditions

Stop before apply or activation if any real-provider code/data appears, an artifact is not versioned
and digest-bound, a gate is enabled out of order, queue content contains candidate or source
payloads, PostgreSQL
evidence is incomplete, the plan has unrelated drift, or the separately owned external/audited
source-control gate is absent. A Lambda environment value is immutable for an in-flight version and
is not the future real-time provider kill switch.

This source packet does not prove artifact publication, Terraform apply, AWS execution, provider
authorization, dynamic kill-switch operation, or production ingestion.
