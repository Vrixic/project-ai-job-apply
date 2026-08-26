# Development D1 Provider-Failure Acceptance

This runbook operates one bounded, generated-synthetic provider-failure recovery execution in the
isolated AWS development account. It is not a source activation, provider test, load test, alert
delivery test, production SLO, or authorization to process candidate or provider data.

The fixed fixture is:

- kind `d1-generated-synthetic-provider-failure-v1`;
- source and adapter `synthetic-d1-provider-fault-v1`;
- one attempt-1 `source_unavailable` result, one durable wait, and one empty recovery;
- zero provider requests, observations, withdrawals, catalog writes, and audit rows.

The operator invokes only the exact numeric deployed ingestion durable Lambda version. That
version is state- and configuration-bound to the exact numeric ingestion activity version. It does
not call the coordinator, starter, terminal handler, schedule, event-source mapping, queue, ECS, or
provider. Lambda execution names are the one-run idempotency boundary; AWS documents that named
durable executions prevent duplicate starts. The operator also reduces the service's contains-name
listing response to an exact case-sensitive name and exact numeric function ARN before counting a
listing response to an exact case-sensitive name, unqualified function ARN, and separate numeric
version before counting a match. AWS durable list/get responses are accepted only when `FunctionArn` is the exact unqualified
function ARN and the separate `Version` field is the expected numeric version. See
[Lambda durable idempotency](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html),
[Invoke](https://docs.aws.amazon.com/cli/latest/reference/lambda/invoke.html), and
[GetDurableExecution](https://docs.aws.amazon.com/lambda/latest/api/API_GetDurableExecution.html).

## Preconditions

Use PowerShell 7 for the deployed operation. PowerShell 7 and Windows PowerShell 5.1 must both pass
the offline contract suite. Before Plan or Execute, require:

1. A clean `main` checkout exactly equal to `origin/main` and the supplied release SHA.
2. A fresh temporary IAM Identity Center assumed-role session in the exact development account and
   region `us-east-2`.
3. The exact versioned, public-blocked, customer-KMS Terraform state bucket and state serial named
   in the reviewed representative configuration.
4. A representative configuration with status `reviewed`, the same lowercase UUIDv4 and source
   SHA, all generated-synthetic/one-run/cleanup/recovery flags true, and the exact available fixture
   identity and operator path.
5. Exact numeric durable/activity versions, hex artifact SHA-256 values, and Lambda base64 code
   SHA-256 values from the immutable release record. Never copy an alias or `$LATEST` value.
6. The configuration's checksum-bound zero-change runtime plan. The operator inspects it again and
   requires every resource action to be `no-op`. Plan also creates a new refresh-backed Terraform
   plan, requires it to be zero change, and binds its private path and checksum into the descriptor.

Plan fails closed unless state and live AWS agree that both immutable versions are exact, the
durable version names the exact activity version, schedule and terminal EventBridge rules are
disabled, every event-source mapping across the durable, activity, coordinator, starter, and
terminal functions is enumerated and the sole Terraform-owned mapping is disabled, normal
synthetic ingestion and provider authority are false on the activity and all three runtime
functions, provider sources are `[]`, no NAT gateway exists, dispatch and dead-letter queues are
empty, ECS has no service or running task, and the UUID-derived execution does not exist.

Run the offline suite before using credentials:

```powershell
pwsh -NoProfile -File `
  scripts/tests/development-d1-provider-failure-acceptance-operator.tests.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  scripts/tests/development-d1-provider-failure-acceptance-operator.tests.ps1
```

## Validate and plan

Keep the reviewed configuration and every generated operator artifact below the ignored
development `.terraform` directories. Validate performs no external access:

```powershell
.\scripts\operate-development-d1-provider-failure-acceptance.ps1 -Action Validate `
  -SourceSha '<40-character-release-sha>' `
  -RunId '<lowercase-uuid-v4>' `
  -RepresentativeConfigPath '<ignored-reviewed-config.json>' `
  -ReviewedConfigSha256 '<reviewed-config-sha256>'
```

Plan is read-only against AWS, runs a fresh refresh-backed Terraform plan without applying it, and
writes one 30-minute descriptor:

```powershell
.\scripts\operate-development-d1-provider-failure-acceptance.ps1 -Action Plan `
  -ExpectedAccountId '<development-account-id>' -StateBucket '<state-bucket>' `
  -SourceSha '<release-sha>' -RunId '<uuid-v4>' `
  -RepresentativeConfigPath '<ignored-reviewed-config.json>' `
  -ReviewedConfigSha256 '<reviewed-config-sha256>' `
  -ExpectedDurableVersion '<numeric-version>' `
  -ExpectedActivityVersion '<numeric-version>' `
  -ExpectedDurableArtifactSha256 '<hex-sha256>' `
  -ExpectedDurableCodeSha256 '<base64-sha256>' `
  -ExpectedActivityArtifactSha256 '<hex-sha256>' `
  -ExpectedActivityCodeSha256 '<base64-sha256>'
```

Independently review the emitted descriptor. It contains identities and hashes, not a caller
payload, provider setting, log body, or mutation command. Record its exact SHA-256.

## Execute once

Execute re-runs every gate, requires the descriptor to be unexpired and unchanged, writes an
exclusive pre-invocation receipt, and then performs the one named asynchronous invocation:

```powershell
.\scripts\operate-development-d1-provider-failure-acceptance.ps1 -Action Execute `
  <all Plan arguments> `
  -ExecutionPlanPath '<ignored-plan.json>' `
  -ReviewedExecutionPlanSha256 '<reviewed-plan-sha256>'
```

Do not run Execute again for the UUID under any outcome. The pre-invocation receipt is deliberately
written before the AWS call. If invocation transport is ambiguous, if polling times out, or if a
post-run check fails, preserve that receipt and proceed only through Verify. Named invocation is
idempotent, but this operating contract still forbids a second mutation attempt.

The operator polls for at most five minutes by default. It requires the terminal execution to
cross-bind the exact execution ARN/name, unqualified function ARN plus numeric durable version,
private input, run UUID, reviewed
configuration digest, release SHA, fixture/source/adapter identities, one fault, one observed
failure, one recovery attempt, one successful recovery, and all four provider/write counts at zero.
The AWS CLI returns durable `InputPayload` and `OutputPayload` as JSON strings; the operator applies strict
UTF-8 byte bounds and exact closed-object validation without printing either string.

## Resume and verify

Verify never invokes Lambda. It may recover the exact execution ARN from an invocation-pending
receipt, resume bounded polling, and complete aggregate evidence:

```powershell
.\scripts\operate-development-d1-provider-failure-acceptance.ps1 -Action Verify `
  <all Plan arguments> `
  -ExecutionPlanPath '<ignored-plan.json>' `
  -ReviewedExecutionPlanSha256 '<reviewed-plan-sha256>' `
  -ReceiptPath '<ignored-receipt.json>' `
  -ReviewedReceiptSha256 '<reviewed-receipt-sha256>'
```

If verification advances an incomplete receipt, independently record the new receipt checksum.
For a completed receipt, Verify rechecks the state/configuration/immutable versions, disabled
triggers and mappings, provider/NAT gates, empty queues, idle ECS, exact single retained execution,
evidence checksums, and evidence contents. After the execution completes, the operator rereads the
exact versioned Terraform state and runs a new refresh-backed zero-change plan; it never reuses the
pre-run plan as post-run drift proof. An already verified receipt is accepted only when its exact
destinations, checksums, state version, post-run plan checksum, aggregate schema, and zero-drift
schema all validate.

## Evidence and privacy

The provider aggregate is written only to the configuration's ignored private path and has profile
`d1_deployed_provider_failure_recovery_v1`. It contains fixed fixture/source/adapter identities,
timestamps/duration, exact fault/recovery counts, `cleanupAttempted=true`,
`cleanupSucceeded=true`, `postCleanupArtifacts=0`, `retainedAuditRows=0`,
`retainedDurableExecutions=1`, and aggregate queue/DLQ/log-privacy metrics. Here,
`postCleanupArtifacts` means mutable operator payload/output files and workload artifacts; the
reviewed plan, receipt, aggregate, zero-drift record, and retained AWS durable history are evidence,
not cleanup defects.

Invocation payload and CLI output files are removed in the invocation `finally` path. Evidence is
not marked cleanup-successful until their absence is proved. Aggregate and zero-drift files are
written atomically; after a crash, retained files must pass the same closed-schema validation and
are reused byte-for-byte rather than overwritten.

The aggregate never contains payloads, log bodies, ARNs, account IDs, run IDs, configuration or
release hashes, candidate facts, provider records, emails, tokens, or recipient identities. Logs
Insights returns counts only. The operator does not infer alert delivery from an alarm state and
does not emit an alert-delivery confirmation. The independent human-confirmed alert exercise
remains required by the representative acceptance composition.

The separate `d1_post_run_zero_drift_v1` record binds the release source, reviewed runtime-plan
digest, and exact state serial with zero meaningful changes and `drift=false`. Treat both files as
development evidence only; they do not establish production reliability or remove accountable
security, privacy, accessibility, source-quality, or alert-recipient review.
