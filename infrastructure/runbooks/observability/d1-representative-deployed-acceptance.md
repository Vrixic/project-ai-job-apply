# D1 Representative Deployed Acceptance

This runbook defines the source-only, fail-closed composition boundary for the remaining Phase 1
representative reliability gate. It does not define service objectives. An accountable reviewer
must supply every concurrency, latency, duration, error, queue, alarm, and alert-recipient input for
the exact frozen release. The source-controlled example is intentionally `draft`, contains no
threshold values, and cannot execute.

The operator consumes aggregate metrics only. Use only the approved generated-synthetic managed
OIDC identity and generated-synthetic provider fixtures. Never put a token, email address, account
identifier, resource ARN, preference, job identifier, saved-job identifier, request/response body,
provider record, or candidate fact in the configuration or result files.

## Current safety state

`scripts/operate-d1-representative-acceptance.ps1` is an offline validator and evidence composer.
It never invokes AWS, Terraform, Vercel, GitHub Actions, Docker, WSL, a provider, or a product
mutation. The schema accepts `providerFailure.state` only as `blocked` or `available`. `available`
is not a caller-defined escape hatch: it binds the fixed
`d1-generated-synthetic-provider-failure-v1` fixture, source and adapter
`synthetic-d1-provider-fault-v1`, source path
`scripts/operate-development-d1-provider-failure-acceptance.ps1`, and one aggregate result below
the ignored acceptance directory. Readiness remains blocked until that source operator and result
exist. `Execute` remains deliberately unavailable in this composer; invoke only the separately
reviewed fixture operator. Do not substitute the historical Ashby activation or manufacture a
result file.

Alert delivery also retains a human boundary: the existing canary operator can safely exercise the
synthetic metric and can emit the strict aggregate JSON, but notification receipt still needs its
exact attributable manual confirmation. The acceptance composer validates that aggregate; it does
not infer delivery from CloudWatch or SNS state alone.

## Prepare a reviewed configuration

1. Copy
   `infrastructure/observability/d1-representative-acceptance.example.json` to
   `infrastructure/terraform/environments/development/.terraform/d1-representative-acceptance/config.json`.
   The ignored directory is mandatory for reviewed thresholds, recipient-set bindings, and run
   results.
2. Bind `release.sourceSha`, the exact post-release Terraform state serial, the already-applied
   saved runtime plan and SHA-256, plus the exact gateway, workflow-ingress, durable, and activity
   artifact digests/object versions. Bind the migration image separately by release source,
   immutable platform digest, and publication-receipt SHA-256. Do not use a latest alias or mutable
   key.
3. Generate one lowercase version-4 run UUID. The direct fixture creates no Jobs/database ledger or
   checkpoint. `generatedSyntheticOnly`, `oneRunOnly`, `cleanupRequired`, and `recoveryRequired`
   must remain `true`.
4. Have accountable owners review and enter every threshold. There are no defaults. The fixed
   development read profile has concurrency `2`; the saved-job and match profiles are single-flight
   and therefore use concurrency `1`. The bounded provider-failure fixture is also single-flight,
   so its explicitly reviewed concurrency must be `1`.
5. Review the exact workload-profile and complete platform alarm counts separately. The workload
   inspectors currently require ten profile-specific alarms; alert status covers all 43 managed
   runtime alarms. Review the exact number of confirmed alert recipients. Store only the count and
   a SHA-256 of a separately controlled canonical recipient set; never store the recipient values.
6. Keep `providerFailure.state = blocked`, its nonempty blocker, and a null fixture binding until
   the exact separate operator is present and reviewed. To bind already-produced evidence, change
   the state to `available`, set the blocker to null, and use only this exact object (with the result
   path completed below the ignored acceptance directory):

```json
{
  "kind": "d1-generated-synthetic-provider-failure-v1",
  "sourceId": "synthetic-d1-provider-fault-v1",
  "adapterVersion": "synthetic-d1-provider-fault-v1",
  "operatorPath": "scripts/operate-development-d1-provider-failure-acceptance.ps1",
  "aggregateResultPath": "infrastructure/terraform/environments/development/.terraform/d1-representative-acceptance/provider-failure.json"
}
```

7. Set every other aggregate result path below the ignored acceptance directory. Keep status `draft`
   until the exact release, thresholds, recipient binding, cleanup/recovery rules, and result paths
   have attributable review. Then change only `status` to `reviewed` and calculate the file hash:

```powershell
(Get-FileHash -LiteralPath `
  '.\infrastructure\terraform\environments\development\.terraform\d1-representative-acceptance\config.json' `
  -Algorithm SHA256).Hash.ToLowerInvariant()
```

Validate the structural shape at any time:

```powershell
.\scripts\operate-d1-representative-acceptance.ps1 -Action Validate -ConfigPath `
  '.\infrastructure\terraform\environments\development\.terraform\d1-representative-acceptance\config.json'
```

Plan with the independently reviewed checksum:

```powershell
.\scripts\operate-d1-representative-acceptance.ps1 -Action Plan -ConfigPath `
  '.\infrastructure\terraform\environments\development\.terraform\d1-representative-acceptance\config.json' `
  -ReviewedConfigSha256 '<reviewed-config-sha256>'
```

The plan remains `Executable: false` while the provider-failure state is blocked, the fixed fixture
operator is missing, or its aggregate result has not been produced. `Executable` here describes a
complete evidence boundary; it does not authorize this composer to mutate AWS.

## Aggregate evidence contracts

Run the three existing managed-OIDC profiles exactly as documented in
`development-d1-read-workload.md`. Retain only their displayed aggregate JSON. Corroborate each
exact timestamp window with `inspect-development-workload-and-cost.ps1` using `D1Read`,
`D1SavedJob`, and `D1Match`, and retain its complete JSON output without adding or removing fields.
The composer requires:

- the fixed read counts, four contract baselines, reviewed p95 and duration limits, and bounded
  application failures;
- one saved-job write, replay, expected conflict, exact delete, and post-cleanup absence;
- one catalog page, one match assessment, and a positive aggregate evidence-item count;
- reviewed API/Lambda latency, error, throttle, backlog, DLQ, privacy-log, profile-specific healthy-
  alarm, idle-ECS, durable-trigger, and zero-drift bounds for each AWS window.

The alert status aggregate has profile `d1_deployed_alert_status_v1` and contains only the
check timestamp, confirmed/pending recipient counts, canary state, ALARM/OK action counts, and
the complete managed platform runtime-alarm count. This count is intentionally distinct from each
workload inspector's profile-specific alarm count. The exercise aggregate has profile
`d1_deployed_alert_delivery_v1` and contains only timestamps, duration, one ALARM transition, one
recovery transition, delivery confirmation, the reviewed recipient-set SHA-256, and final `OK`.

The provider-failure result has profile `d1_deployed_provider_failure_recovery_v1` and cross-binds
the exact fixture kind, source ID, and adapter version above. It must prove exactly one injected
fault, one observed failure, one recovery, attempted/successful cleanup, reviewed queue/DLQ bounds,
and reviewed privacy-log bounds. Alert delivery remains a separate aggregate and is never copied or
inferred into the provider result. `postCleanupArtifacts = 0` means zero cleanup-required mutable or
operational fixture artifacts; it does not mean audit history was deleted. The direct durable design
retains no Jobs/database audit row, so `retainedAuditRows` must be `0`, while the intentional one-run
AWS durable history remains and
`retainedDurableExecutions` must be `1`. The separate
`d1_post_run_zero_drift_v1` result binds the exact source, runtime-plan digest, and state serial and
requires zero meaningful changes and `drift = false`.

Assess already-produced aggregates without causing an external effect:

```powershell
.\scripts\operate-d1-representative-acceptance.ps1 -Action Assess -ConfigPath `
  '.\infrastructure\terraform\environments\development\.terraform\d1-representative-acceptance\config.json' `
  -ReviewedConfigSha256 '<reviewed-config-sha256>'
```

Assessment reports `ProviderFailureAutomated: true` only after the separate fixed aggregate passes;
it never derives that state from source availability alone. Overall `Accepted` can become true only
when all three application/AWS profiles, the provider aggregate, alert delivery, post-run zero
drift, and every reviewed input pass with no blocking issue. A failed or interrupted fixture run
must preserve its one-run durable history, perform only its exact cleanup/recovery operation, and
finish with aggregate post-cleanup and zero-drift evidence. Never retry a mutation when cleanup is
unproved, never reuse a run UUID, never delete the retained durable audit history, and never
reinterpret these measurements as a production SLO or capacity promise.
