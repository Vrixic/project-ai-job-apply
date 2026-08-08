# Phase 0 Provider Retirement

This runbook removes the final Temporal and legacy container artifacts after both environments
accept the Lambda/durable runtime. Execute development and staging independently. Never reuse a
plan, account, state bucket, migration image, or provider key across environments.

## Preconditions

- Exact clean upstream-matched `main` and Terraform `1.9.8`.
- Correct IAM Identity Center profile and account in `us-east-2`.
- Latest accepted zero-change serverless baseline plan.
- Accepted post-retirement browser persistence and cross-user isolation.
- Zero unpublished legacy outbox rows and zero running Temporal workflows.
- RDS backup/PITR, encrypted state, alarms, queues, and durable runtime remain healthy.

The guarded operator is `scripts/operate-phase0-provider-retirement.ps1`. Run `-Help` for the exact
parameter contract. Plans live only below the ignored environment `.terraform/provider-retirement-
plans` directory and may contain sensitive values; never commit or attach them.

## 1. Create the dedicated migration repository

Run `PlanRepository` with the exact account, state bucket, and accepted baseline. Review `Status`.
The plan must create exactly `module.platform.aws_ecr_repository.migration` and nothing else.
Authorize and apply only its returned SHA-256.

## 2. Publish and select a migration image

Run the protected `Publish environment images` GitHub workflow for the selected environment. It
builds only `Dockerfile.migration`, pushes to `ai-job-apply/migration`, waits for scan completion,
and rejects any High or Critical finding. Record the exact platform digest, not a mutable tag.

Run `PlanMigration` with `REPOSITORY@sha256:DIGEST`. It accepts only the migration task-definition
replacement and, if required, its database-secret execution policy. Review and apply its checksum.

## 3. Apply the fail-closed database migration

Run `RunMigration -Execute` with the same digest. The operator verifies repository ownership and
scan state, launches one Fargate task, waits for it to stop, and requires exit code `0`. Migration
`0003_retire_legacy_dispatch` refuses to proceed if any unpublished Temporal outbox row exists. It
relabels only already-published historical rows and makes `lambda_durable` the sole active target.

Do not revoke provider access if this step fails. Investigate aggregate counts without reading
candidate values or identifiers.

## 4. Revoke provider keys

For the selected environment, revoke the exact Temporal Cloud API key whose value remains in the
AWS managed secret. Do not delete the AWS secret yet. Prove rejection with:

```powershell
pnpm --filter @ai-job-apply/workflows temporal:retirement-inspect -- `
  --profile AWS_PROFILE `
  --region us-east-2 `
  --secret-id ai-job-apply/ENVIRONMENT/temporal-api-key `
  --address TEMPORAL_GRPC_ENDPOINT `
  --namespace TEMPORAL_NAMESPACE `
  --mode revoked
```

The check must return exact-key `PERMISSION_DENIED` or `UNAUTHENTICATED` without printing the key
or identifiers. Temporal Cloud can use either gRPC access-rejection code for a deleted key; a
transport, availability, namespace, or unclassified error does not satisfy retirement.

## 5. Remove legacy image contents

Only after the dedicated migration task is deployed and provider revocation passes, run
`PurgeLegacyImages` with both explicit confirmation switches and `-Execute`. This permanently
deletes image manifests from exactly `ai-job-apply/gateway` and `ai-job-apply/worker`; they are no
longer deployable from current source. Record only aggregate repository/image counts.

## 6. Plan and apply final AWS cleanup

Run `PlanCleanup -ConfirmTemporalKeyRevoked`. The guarded plan must preserve RDS, backups, KMS, S3,
queues/DLQs, API Gateway, Lambda functions/aliases, durable state, alarms, cost controls, ECS
cluster, application security group, and the migration repository/task. It deletes the empty
gateway/worker repositories, Temporal secret container, obsolete application task role, and
obsolete ingress security group, while narrowing remaining secret policies.

Review the full plan independently. Apply only the exact authorized SHA-256. Secrets Manager may
retain the deleted secret through its configured recovery window; do not force immediate deletion.

If AWS applies part of the plan but an historical application ingress rule blocks deletion of the
obsolete ingress group, do not replay the consumed plan or remove the rule manually. Merge the
explicit-empty-ingress source boundary, then run `PlanCleanupRecovery` with both retirement
confirmations. Its saved plan must contain exactly one application-security-group update that
removes the historical TCP/4000 source-group rule and one deletion of the obsolete ingress group.
Review and apply only that recovery plan's exact SHA-256.

## 7. Verify and finish source cleanup

Run `Verify` with the accepted migration digest. Require zero Terraform drift, healthy public
Lambda routes, protected anonymous behavior, enabled durable triggers, absence of retired AWS
inventory, and retained migration capability. Repeat preference persistence, operation completion,
and two-account isolation.

After both environments pass, remove the temporary Temporal inspection dependency/script and all
obsolete cutover operators/runbooks. Update SR-009, Phase 0, the master delivery tracker, security
inventory, cost evidence, and final completion record together.
