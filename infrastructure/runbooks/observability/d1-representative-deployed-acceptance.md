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
mutation. `Execute` is deliberately unavailable because no current guarded generated-synthetic
fixture can inject exactly one bounded provider failure, prove degraded behavior, recover, and
clean every artifact. Do not substitute the historical Ashby live activation or manufacture a
result file. Implement and independently review that fixture before changing the schema's
`providerFailure.state = blocked` boundary.

Alert delivery also retains a human boundary: the existing canary operator can safely exercise the
synthetic metric, but it does not emit the strict aggregate JSON required here and notification
receipt needs attributable operator confirmation. The acceptance composer validates that future
aggregate; it does not infer delivery from CloudWatch state alone.

## Prepare a reviewed configuration

1. Copy
   `infrastructure/observability/d1-representative-acceptance.example.json` to
   `infrastructure/terraform/environments/development/.terraform/d1-representative-acceptance/config.json`.
   The ignored directory is mandatory for reviewed thresholds, recipient-set bindings, ledgers,
   and run results.
2. Bind `release.sourceSha`, the exact post-release Terraform state serial, the already-applied
   saved runtime plan and SHA-256, plus the exact gateway, workflow-ingress, durable, and activity
   artifact digests/object versions. Bind the migration image separately by release source,
   immutable platform digest, and publication-receipt SHA-256. Do not use a latest alias or mutable
   key.
3. Generate one lowercase version-4 run UUID. Set an unused ledger path below the same ignored
   directory. `generatedSyntheticOnly`, `oneRunOnly`, `cleanupRequired`, and `recoveryRequired`
   must remain `true`.
4. Have accountable owners review and enter every threshold. There are no defaults. The fixed
   development read profile has concurrency `2`; the saved-job and match profiles are single-flight
   and therefore use concurrency `1`. The provider-failure concurrency must still be explicitly
   reviewed even though its execution remains blocked.
5. Review the exact number of confirmed alert recipients. Store only the count and a SHA-256 of a
   separately controlled canonical recipient set; never store the recipient values.
6. Set all aggregate result paths below the ignored acceptance directory. Keep status `draft`
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

The plan must remain `Executable: false` while the provider-failure blocker exists.

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
- reviewed API/Lambda latency, error, throttle, backlog, DLQ, privacy-log, healthy-alarm, idle-ECS,
  durable-trigger, and zero-drift bounds for each AWS window.

The future alert status aggregate has profile `d1_deployed_alert_status_v1` and contains only the
check timestamp, confirmed/pending recipient counts, canary state, ALARM/OK action counts, and
healthy runtime-alarm count. The exercise aggregate has profile
`d1_deployed_alert_delivery_v1` and contains only timestamps, duration, one ALARM transition, one
recovery transition, delivery confirmation, the reviewed recipient-set SHA-256, and final `OK`.

The future provider-failure result has profile
`d1_deployed_provider_failure_recovery_v1`. It must prove exactly one injected fault, one observed
failure, one recovery, attempted/successful cleanup, zero remaining artifacts, confirmed alert
delivery, reviewed queue/DLQ bounds, and reviewed privacy-log bounds. The separate
`d1_post_run_zero_drift_v1` result binds the exact source, runtime-plan digest, and state serial and
requires zero meaningful changes and `drift = false`.

Assess already-produced aggregates without causing an external effect:

```powershell
.\scripts\operate-d1-representative-acceptance.ps1 -Action Assess -ConfigPath `
  '.\infrastructure\terraform\environments\development\.terraform\d1-representative-acceptance\config.json' `
  -ReviewedConfigSha256 '<reviewed-config-sha256>'
```

Assessment always remains `Accepted: false` while provider-failure automation is blocked. A failed
or interrupted future run must preserve its one-run ledger, perform only its exact cleanup/recovery
operation, and finish with aggregate post-cleanup and zero-drift evidence. Never retry a mutation
when cleanup is unproved, never reuse a run UUID, and never reinterpret these measurements as a
production SLO or capacity promise.
