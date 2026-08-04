# Phase 0 ECS Idle Shutdown

Use this procedure only for an explicitly accepted zero-traffic development or synthetic-staging
environment. It stops continuous gateway and Temporal-worker Fargate tasks before Lambda cutover
without deleting the rollback services or persistent platform.

## Preconditions

- [ADR-017](../../../docs/adr/017-zero-traffic-precutover-ecs-idle-posture.md) is accepted.
- The idle-shutdown source is merged and the local checkout is clean, synchronized `main`.
- Terraform 1.9.8 and the selected environment's encrypted backend are initialized.
- The selected IAM Identity Center profile is refreshed and maps to the exact isolated account.
- The product owner confirms zero traffic and accepts that the environment API and normal workflow
  processing will remain unavailable until Lambda cutover or an explicit ECS resume.
- Do not disable or delete RDS, S3, SQS/DLQ, KMS, Secrets Manager, backups, API Gateway, VPC Link,
  Cloud Map, ECS task definitions/images, Lambda resources, or Temporal access in this procedure.

## Development plan and apply

```powershell
aws sso login --profile ai-job-apply-development-admin

.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment development `
  -Action PlanIdle `
  -ConfirmZeroTraffic `
  -RetainedTerraformPlanPath .terraform/worker-drain-development.tfplan
```

Review the sanitized result. It must report zero pending outbox rows, zero running Temporal
workflows, exactly four updates, and zero creates, deletes, or replacements. Independently retain
the printed plan SHA-256; do not copy the sensitive plan or ignored context into evidence.

```powershell
.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment development `
  -Action ApplyIdle `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -ConfirmZeroTraffic `
  -Execute

.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment development `
  -Action VerifyIdle
```

## Staging plan and apply

Refresh the staging account independently and repeat the same isolated sequence:

```powershell
aws sso login --profile ai-job-apply-staging-admin

.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment staging `
  -Action PlanIdle `
  -ConfirmZeroTraffic

.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment staging `
  -Action ApplyIdle `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -ConfirmZeroTraffic `
  -Execute

.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment staging `
  -Action VerifyIdle
```

Never reuse one environment's checksum, ignored plan, context, profile, or Terraform state for the
other environment. A retained plan is mandatory when Terraform state contains any serverless
gateway, outbox, or durable-workflow resource. It may be omitted only when the operator proves
those resources are absent and supplies the explicit disabled serverless defaults.

## Acceptance

For each environment require:

- gateway service `ACTIVE`, desired/running/pending `0/0/0`;
- workflow-worker service `ACTIVE`, desired/running/pending `0/0/0`;
- zero running ECS tasks in the environment cluster;
- the two task ENIs captured before shutdown no longer retain public IPs;
- gateway/worker heartbeat alarm actions disabled and missing data non-breaching;
- a refresh-backed targeted plan reports zero drift;
- API Gateway, VPC Link, Cloud Map, ECS service/task definitions, images, Temporal secret, and all
  persistent resources remain present for rollback.

The unavailable API is expected in this posture and is not a reason to resume ECS automatically.
All new functional testing proceeds against the Lambda replacement after its controlled cutover.

## Explicit resume

Resume only for an approved rollback. Create and review the reverse plan separately:

The commands below require the ignored context produced by a successful operator-managed idle
apply. If an accepted idle apply was completed through an independently reviewed equivalent plan
and that context is absent, stop. Reconstruct a refresh-backed reverse plan from the retained live
task definitions and exact environment inputs under a separate reviewed recovery procedure; do
not synthesize or copy an operator context.

```powershell
.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment development `
  -Action PlanResume

.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment development `
  -Action ApplyResume `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

The reverse apply must restore both services to `1/1/0`, restore heartbeat actions and breaching
missing-data treatment, and return the targeted boundary to zero drift. Repeat with the staging
profile only when staging is the approved rollback target.

Remove ignored operator artifacts only after a successful resume. Destructive retirement owns its
own final cleanup after it makes rollback permanently unavailable:

```powershell
.\scripts\operate-phase0-ecs-idle-shutdown.ps1 `
  -Environment development `
  -Action Cleanup `
  -Execute
```
