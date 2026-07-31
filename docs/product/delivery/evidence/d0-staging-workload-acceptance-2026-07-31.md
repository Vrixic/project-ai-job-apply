# D0 Staging Workload Acceptance — 2026-07-31

## Scope

This record covers the immutable staging worker correction, its controlled rollout, the corrected
fixed workload, and exact-window AWS corroboration. It completes the Phase 0 staging workload and
deployed-engineering acceptance gates. It does not complete operating-cost acceptance, external
legal/privacy review, external security/privacy approval, or representative ATS fixture approval.

All workload data was synthetic. Evidence retains aggregate counts, latency/utilization,
checksums, image digests, and pass/fail state only; it retains no token, identity, preference,
operation/workflow identifier, endpoint, account identifier, provider key, or raw log/trace.

## Corrected immutable worker

PR [#53](https://github.com/Vrixic/project-ai-job-apply/pull/53) merged the outbox-starvation
correction as commit `fabda3a4bed1433de2d2c923e34256ec8a9d3dc0`. Protected GitHub run
[30655294275](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30655294275) used
environment-scoped AWS OIDC to publish the staging images from that exact merged source.

Independent ECR inspection proved the worker image boundary:

- immutable OCI index: `sha256:8d0743e68a83aae73ccadd66d819f4fd3adb33a491671eb77e7758d08f351475`;
- exactly one `linux/amd64` manifest:
  `sha256:b23d8538e222104725b84d1697a8fd8951611889619072eb35186ac35770b7a7`;
- scan status `COMPLETE`; and
- zero critical and zero high findings.

The refresh-backed rollout plan had SHA-256
`74487D30F217533008919B44BA6E24DAB73A81AA67F3746A059039677232A836`. Semantic inspection
allowed exactly one create-before-delete replacement of the worker task definition and one worker
service update. Only the worker image and its derived release marker changed. The plan contained
zero gateway, database, KMS, S3, SQS/DLQ, ECR, Secrets Manager, network, state, migration, replica,
or other persistent-resource changes. The exact checksum-matched artifact applied successfully.

Post-rollout verification proved:

- the worker converged to stable `1/1/0` and runs the approved digest/release marker;
- the gateway task definition remained unchanged;
- gateway liveness/readiness/protected behavior remained `200/200/401`;
- one corrected-worker startup event and ten worker heartbeat events were present in the inspected
  rollout window;
- all eight managed alarms were `OK`;
- the refresh-backed plan reported zero drift; and
- the three ignored rollout context/plan artifacts were removed after verification.

## Fixed workload result

The product owner ran `phase0_staging_foundation_v1` once from the explicitly enabled local-only
staging control. It started at `2026-07-31T18:52:06.969Z`, ended at
`2026-07-31T18:52:38.149Z`, and completed in 31,179 ms.

| Measurement | Result |
|---|---:|
| Public requests | 500 |
| Public failures | 0 |
| Liveness p50 / p95 / max | 49 / 104 / 291 ms |
| Readiness p50 / p95 / max | 49 / 100 / 301 ms |
| Expected unauthorized p50 / p95 / max | 49 / 58 / 61 ms |
| Durable workflow attempts | 25 |
| Durable workflows succeeded | 25 |
| Idempotent replay | Matched |
| Writes p50 / p95 / max | 79 / 94 / 96 ms |
| Workflow propagation p50 / p95 / max | 1,000 / 1,037 / 1,096 ms |

This passes the fixed browser acceptance boundary: 500/500 public probes, 25/25 sequential
preference/outbox/Temporal workflows, and one exact matching idempotent replay.

## AWS corroboration

The read-only operator queried the exact workload timestamps with bounded metric padding. The
4.52-minute measurement window returned:

| Measurement | Result |
|---|---:|
| API requests | 621 |
| Expected `4xx` | 100 |
| API `5xx` | 0 |
| API average / maximum latency | 12.04 / 314 ms |
| Gateway maximum CPU / memory | 17.97% / 25.68% |
| Worker maximum CPU / memory | 8.25% / 16.94% |
| Database maximum CPU / connections | 5.28% / 1 |
| Event-queue oldest age / DLQ messages | 0 seconds / 0 |
| Log events | 1,276 |
| Error / forbidden-log matches | 0 / 0 |
| Stable services / managed alarms `OK` | 2 / 8 |
| Terraform drift | 0 |

The 621 API requests exceed the minimum 552 corroboration boundary because the fixed public
probes are accompanied by authenticated writes, operation polling, replay, and bounded health
checks. The operator records no request or response payload.

## Acceptance and remaining boundary

The corrected fixed workload, reproducible quality/reliability measurement, D0-006 deployed
engineering foundation, and D0-011 lean AWS environment acceptance now pass.

D0-008 operating-cost acceptance remains open. Cost Explorer still reports the current partial
month as provider-estimated `$0.00`, with zero nonzero-cost services, zero AWS Budgets, and zero
legacy CUR definitions. The development IAM Identity Center session was expired when the final
two-account cost read was attempted. Refresh both account sessions, wait for nonzero attributable
billing, and apply separately reviewed budget/export controls before accepting cost evidence.
