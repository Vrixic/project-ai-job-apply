# Phase 0 legacy runtime retirement

Use this runbook only after both Lambda environments have completed cutover, rollback/restoration,
fixed workload, tenant-isolation, empty-work, alarm, log-privacy, and zero-drift acceptance. The
product owner expired the development and staging rollback windows at
`2026-08-08T02:56:32.831Z`.

## Boundary

The reviewed retirement deletes only the stopped gateway/worker ECS services and task definitions,
their VPC Link and HTTP proxy integration, their Cloud Map namespace/service, application tracing
policy, two heartbeat filters, and two heartbeat alarms. It also removes obsolete ECS/heartbeat
widgets from the operations dashboard.

It does not delete or disable API Gateway's JWT-protected Lambda integration, Lambda durable
workflow functions or triggers, RDS, S3, SQS/DLQ, KMS, backup resources, ECR repositories, the ECS
cluster and on-demand migration task, Secrets Manager containers, serverless alarms, budgets, or
cost exports. Temporal credential/provider retirement and executable repository cleanup are the
separate SR-009 boundary.

## Plan and review

Start from exact clean upstream-matched `main`, a temporary IAM Identity Center session for the
target account, the encrypted state bucket, and that environment's most recent accepted
`serverless-runtime-cutover-verify-<commit>.tfplan`.

```powershell
.\scripts\operate-development-legacy-runtime-retirement.ps1 `
  -Action Plan `
  -ExpectedAccountId DEVELOPMENT_ACCOUNT_ID `
  -StateBucket DEVELOPMENT_STATE_BUCKET `
  -BaselinePlanPath .terraform/workflow-dark-plans/serverless-runtime-cutover-verify-COMMIT.tfplan
```

Repeat with the staging wrapper and staging inputs. A valid result reports zero creates, one
dashboard update, 13 deletes, zero replacements, and `AwsMutation: false`. Inspect the saved plan
locally and retain its exact SHA-256; do not publish the sensitive binary plan.

## Apply

Apply one environment at a time only after its exact plan and checksum have been reviewed:

```powershell
.\scripts\operate-development-legacy-runtime-retirement.ps1 `
  -Action Apply `
  -ExpectedAccountId DEVELOPMENT_ACCOUNT_ID `
  -StateBucket DEVELOPMENT_STATE_BUCKET `
  -PlanPath .terraform/workflow-dark-plans/legacy-runtime-retirement-COMMIT.tfplan `
  -ExpectedPlanSha256 REVIEWED_SHA256 `
  -ConfirmRollbackExpired `
  -Execute
```

The operator applies the saved plan without replanning, creates a fresh refresh-backed plan, and
fails unless it is zero-change. It also requires public `200/200` health, anonymous protected-route
`401`, and absence of the retired AWS inventory. Complete authenticated save/readiness and
cross-user-isolation checks before accepting each environment.

Start the post-retirement browser boundary with:

```powershell
.\scripts\start-deployed-web-conformance.ps1 `
  -Environment development `
  -GatewayRuntime lambda-retired
```

Use `staging` only after its separately reviewed retirement apply and automated verification pass.

## Recovery

Do not recreate the old ECS/Temporal path after retirement. If the Lambda runtime fails, stop
traffic-changing work, preserve queues and database state, diagnose from serverless logs/alarms,
and roll back only to an already retained immutable Lambda alias/version using the accepted
serverless rollback operator. A decision to recreate retired infrastructure is a new reviewed
architecture and Terraform change, not an operational rollback.
