# D0 Staging On-Demand Reactivation Acceptance — 2026-08-10

## Disposition

The first complete D0-017 lifecycle replay passed from dormant staging through dark recreation,
migration, authenticated acceptance, fixed workload, AWS corroboration, and a separately reviewed
return to dormancy. Staging again has no database, managed interface endpoint, public route,
enabled workflow trigger, queued work, or running ECS task.

This record accepts the lifecycle replay and retained control-plane boundary. D0-017 remains open
only for a complete posted dormant billing interval corroborating removal of RDS and interface
endpoint hourly usage. It does not grant legal/privacy, security/privacy, representative-fixture,
real-user, ATS-submission, or launch approval.

No account identifier, endpoint, resource identifier, candidate value, identity-provider subject,
operation identifier, token, secret, database URL, raw request, raw log, or notification destination
is retained here.

## Reviewed activation and migration

The exact dark activation plan was approved as SHA-256:

```text
d876a0bf5da2c6ab5a39e57a8a9735ff6d861a120ac7c78f4fcdc4b161800e9d
```

It created exactly the eight disposable data-plane resources and updated one dashboard without a
delete, replacement, public route, or workflow-trigger change. Live verification found encrypted,
private, deletion-protected Single-AZ PostgreSQL with seven-day backups, three private-DNS
interface endpoints, empty queues, and zero running ECS tasks.

One digest-pinned migration task with a completed zero-High/zero-Critical image scan ran exactly
once, exited `0`, verified schema through `0003_retire_legacy_dispatch`, emitted one allowlisted
sanitized success event, and returned ECS to zero tasks.

## Reviewed traffic release

Merged source generated an exact six-action plan approved as SHA-256:

```text
066c101f6e9149b0e11d27da351668e26acd6120f85f8264f7d4a013660a7ec7
```

The plan created only the JWT-protected default route and two anonymous health routes, then enabled
only the outbox SQS mapping and two EventBridge rules. It preserved exact `profile:read` and
`profile:write` scopes and contained zero deletes or replacements. Post-apply status reported three
routes, one enabled mapping, two enabled rules, and empty queues. Direct deployed preflight passed
health `200/200` plus anonymous protected-route `401` behavior.

## Authenticated acceptance

Using two disposable synthetic Auth0 accounts, the product owner confirmed:

- preferences saved through the deployed API and reloaded after a page refresh;
- the associated durable readiness workflow reached `succeeded`; and
- account B received only `Cross-user isolation passed: this account could not read the first
  account's operation.` for account A's opaque operation.

The browser retained no token or operation identifier in the reported result. No preference value
is included in this record.

## Fixed workload and AWS corroboration

The fixed `phase0_staging_foundation_v1` workload ran from `2026-08-10T20:27:29.697Z` through
`2026-08-10T20:27:52.625Z`:

| Measurement | Result |
|---|---:|
| Public probes | 500 |
| Public failures | 0 |
| Readiness workflows | 25/25 succeeded |
| Idempotent replay | Matched |
| Liveness p50 / p95 / max | 68 / 206 / 1,691 ms |
| Readiness p50 / p95 / max | 67 / 78 / 180 ms |
| Unauthorized p50 / p95 / max | 49 / 58 / 65 ms |
| Writes p50 / p95 / max | 106 / 139 / 320 ms |
| Workflow propagation p50 / p95 / max | 424 / 773 / 782 ms |

The read-only AWS inspector independently measured the bounded window plus metric-settling margin:

| AWS boundary | Result |
|---|---:|
| API requests / expected 4xx / 5xx | 585 / 100 / 0 |
| Lambda invocations / errors / throttles | 645 / 0 / 0 |
| Maximum database CPU / connections | 6.6% / 8 |
| Source queue visible / age | 0 / 0 seconds |
| Source DLQ / durable DLQ | 0 / 0 |
| Structured log events | 1,061 |
| Error / forbidden-log matches | 0 / 0 |
| Healthy runtime alarms | 10 |
| Active ECS services / running tasks | 0 / 0 |
| Dispatch / triggers | `lambda_durable` / enabled |
| Refresh-backed Terraform drift | 0 |

The inspector's first local execution reached its command timeout without an AWS assertion result.
It made no mutation and did not replay the workload. The same read-only query was rerun with a
longer local timeout and produced the complete passing result above.

## Reviewed shutdown and final state

The product owner separately approved each boundary:

| Transition | SHA-256 | Exact effect |
|---|---|---|
| Traffic disabled | `960bb61a278a048930ad2b82ed0c046a792311878034b0317f83195f64809c8a` | Deleted three routes and disabled three triggers |
| Runtime quiesced | `17bad5b77dd2d129da79ba956e41ef3d80e8d477275b1b002b1df32011b5781d` | Changed only RDS deletion protection from true to false |
| Runtime dormant | `82c8c6b538c7bb7041bf883995f58970dc83c6ca89379a19c980c0bf53567bcb` | Deleted eight disposable resources and updated one dashboard |

The quiescence Terraform apply completed successfully, but the local wrapper timed out during
post-apply read-back. The consumed plan was not replayed. A separate read-only status check proved
the exact quiesced state before the dormant plan was generated.

The dormant apply deleted the synthetic database without a final snapshot, all three managed
interface endpoints, current generated database-secret value, migration task definition, and two
database alarms. Final live status was:

```json
{
  "Environment": "staging",
  "Mode": "dormant",
  "DatabasePresent": false,
  "DatabaseDeletionProtection": false,
  "ManagedInterfaceEndpoints": 0,
  "PublicRuntimeRoutes": 0,
  "EnabledEventMappings": 0,
  "EnabledEventRules": 0,
  "AggregateQueueDepth": 0
}
```

Remote state retains 119 tracked control-plane resources and zero disposable data-plane resources.
The retained inventory includes KMS, artifact storage, queues/DLQs, IAM, Lambda/durable definitions,
logs/alarms, budgets, and cost exports.

## Remaining gate

Inspect the first complete UTC billing interval after this return to dormancy once AWS has posted
it. Require no staging RDS instance or interface-endpoint hourly usage during that interval and no
unexpected retained-control loss before completing SD-005 and D0-017.
