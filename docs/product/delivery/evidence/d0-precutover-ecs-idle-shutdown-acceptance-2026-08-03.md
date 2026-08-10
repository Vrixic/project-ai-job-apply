# D0 Pre-Cutover ECS Idle-Shutdown Acceptance — 2026-08-03

- Scope: development and synthetic staging legacy ECS gateway/worker runtime
- Status: Accepted retained-idle posture in both isolated AWS accounts
- Decision: [ADR-017](../../../adr/017-zero-traffic-precutover-ecs-idle-posture.md)
- Runbook: [Phase 0 ECS idle shutdown](d0-provider-runtime-repository-cleanup-2026-08-08.md)
- Product-owner condition: both environments have zero traffic; deliberate API and normal-workflow
  unavailability is accepted until Lambda cutover or an explicitly reviewed ECS resume

## Result

Development and synthetic staging each retain their ECS services and rollback resources with the
gateway and workflow-worker desired/running/pending counts at `0/0/0`. Both clusters report zero
running tasks, the two prior task network interfaces in each account retain no public IP, both
expected-heartbeat alarms have actions disabled with missing data treated as non-breaching, and
the targeted Terraform boundary is refresh-backed and drift free.

Each consumed idle plan contained exactly four in-place updates—two service desired-count changes
and two heartbeat-alarm posture changes—with zero creates, deletes, or replacements. Development
used reviewed plan SHA-256
`284665052a46177f59624309b301e1253fa78982cf8c87feef896cabbca54eba`; staging used
`13183e1114a97b63d2f0884eb22013d7a514b8f26b548126bd7bf5ef1a724d28`. The sensitive plan files,
Terraform state, account/role identifiers, task/ENI values, public addresses, secrets, database
records, workflow identifiers, and raw logs are not retained here.

## Development preflight and apply

- The initial aggregate inspection found ten zero-attempt terminal outbox records. The deployed
  worker predated the accepted starvation correction, so a separately reviewed worker-only plan
  replaced its task definition with the scanned corrected image and kept desired count one.
- The replacement worker reached stable `1/1/0` and drained the outbox to zero without exposing an
  event identifier or payload.
- Database migration `0002_serverless_outbox` was applied and verified through the on-demand
  migration task before the final inspection.
- The aggregate outbox inspection returned `pendingCount: 0`; Temporal Cloud reported zero running
  workflows.
- The checksum-matched idle apply changed four resources and nothing else. Final service posture,
  zero cluster tasks, public-IP release, both `OK` idle alarms, and targeted zero drift pass.

## Staging preflight and apply

- The isolated staging caller and encrypted `platform.tfstate` backend were re-established before
  inspection. Both retained services began stable at `1/1/0`.
- The first inspector task failed closed because migration task definition revision one used an old
  image without the inspection entrypoint. No service or persistent resource changed.
- Protected GitHub workflow run
  [30866621175](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30866621175)
  published gateway and worker images from exact merged commit `e630e32`; both ECR high/critical
  gates passed. A one-resource Terraform plan replaced only the on-demand migration task
  definition with the new gateway digest.
- The on-demand task applied and verified `0002_serverless_outbox`. The aggregate outbox inspection
  then returned `pendingCount: 0`, and Temporal Cloud reported zero running workflows.
- The checksum-matched idle apply changed four resources and nothing else. Final service posture,
  zero cluster tasks, public-IP release, both `OK` idle alarms, and targeted zero drift pass.

## Retained rollback and persistent boundary

The procedure did not delete or reroute API Gateway, VPC Link, Cloud Map, ECS services/task
definitions, ECR images, the Temporal namespace/managed secret, RDS/backups/PITR, S3 artifacts,
SQS/DLQ, KMS keys, Secrets Manager values, state, budgets, or cost exports. Development's dark
Lambda gateway/workflow resources and disabled triggers were not changed. The unavailable ECS API
path is expected under the accepted zero-traffic posture.

Fargate remains available only through explicitly started on-demand migration or future owned
browser/ATS tasks. RDS, interface endpoints, logs, storage, and other retained platform resources
continue to incur their own charges; this evidence claims removal of continuous gateway/worker
task and public-IPv4 runtime, not a zero-dollar environment.

## Operator findings

All unsafe or over-broad plans were rejected before apply. The exercise exposed two source-level
false negatives: positional `Compare-Object` use rejected an equal four-address set, and staging
could not provide a JSON-readable retained serverless plan even though its state contains no
serverless resources. The follow-up source uses named comparison inputs and permits explicit
disabled serverless defaults only after Terraform state proves all sentinel serverless resources
are absent. These corrections do not change the already-applied AWS posture.

Because both accepted applies used independently reviewed equivalent plans after the operator
false negative, neither environment retains an operator-generated ignored context or reverse-plan
checksum. A future ECS resume must stop and reconstruct a separate refresh-backed recovery plan
from the retained live task definitions and exact environment inputs; it must not synthesize or
copy an operator context. The services and task definitions themselves remain available.

## Remaining D0-016 gates

- Prove coordinated rollback/restoration between the two accepted development workflow releases.
- Deploy and accept the complete replacement in staging, then development.
- Complete the rollback window, reviewed legacy-resource retirement, Temporal credential/provider
  retirement, repository cleanup, and post-cutover cost reconciliation.
