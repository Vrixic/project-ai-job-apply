# Database Migration

Run schema changes through the retained one-off ECS/Fargate migration task. The ECS cluster has no
service and must return to zero running tasks after every migration.

## Preconditions

- Use exact merged source, Terraform `1.9.8`, and the selected environment's temporary IAM
  Identity Center profile in `us-east-2`.
- Confirm RDS is available, encrypted, deletion protected, and covered by current backups/PITR.
- Build only `Dockerfile.migration`; push it to the environment-local immutable, KMS-encrypted,
  scan-on-push `ai-job-apply/migration` repository.
- Confirm the image contains the migration orchestrator plus every declared independently
  checksum-verifying service-owned migration package. The orchestrator must run owners in declared
  order and stop before later owners if any owner fails.
- Require the exact platform digest to have a complete scan with zero High or Critical findings.
- Review the SQL for transactional behavior, replay safety, bounded locks, data classification,
  downgrade/forward-recovery strategy, and aggregate-only observability.

## Deploy the task definition

Create a refresh-backed Terraform plan with the exact digest URI. The plan may replace only the
one-off migration task definition and narrow execution-secret policy when required. Review and
apply its exact SHA-256. Require a read-only root filesystem, non-root image user, Fargate,
`awsvpc`, the migration command, and only the database secret.

For a development document-schema release, use
`scripts/operate-development-document-migration.ps1`. Keep every saved plan, metadata sidecar,
execution descriptor, receipt, and log under the ignored development `.terraform` directory.
Supply the exact account and state bucket out of band; do not record them in source or shared
evidence.

The task release is deliberately review-separated:

1. `PlanTask` verifies the merged source and immutable ECR artifact, reconstructs every existing
   Terraform input from the checksum-bound retained `ParserDark` or `CompleteDark` verification
   plan, and saves a refresh-backed plan. The adjacent `.baseline.json` sidecar is mandatory and
   must bind the exact current source, account, region, absolute plan path/hash, Terraform 1.9.8
   zero-change shape, current state lineage/serial, exact variable set, publication receipt,
   rollout stage, and applicable parser-version pin. A KMS-prerequisite-only baseline is rejected.
   Pass the verifier's exact `BaselineMetadataSha256` as mandatory
   `-AppliedPlanMetadataSha256`; the operator checks those bytes before parsing the sidecar and
   cross-binds its stage and parser pin to the exact saved-plan variables.
   It rejects resource drift and any meaningful change except a create-before-destroy replacement
   of `module.platform.aws_ecs_task_definition.migration[0]` caused only by the image digest.
2. Independently inspect the saved plan and its `.metadata.json` sidecar, then pass the printed
   SHA-256 to `ApplyTask`. Task metadata binds the retained plan and sidecar paths/checksums, stage,
   state identity, receipt, and parser pin. The apply rechecks that complete handoff against live
   state plus the artifact, plan semantics, encrypted state, task definition, empty cluster, and
   zero-service boundary before reporting success.
3. `PlanExecution` resolves the exact applied task definition, two migration subnets, and one
   application security group into a JSON `run-task` request. Review its SHA-256. If an operator-
   only correction was merged after `ApplyTask`, the release SHA may be an ancestor of the clean
   current `main`; the descriptor binds both the applied release SHA and exact operator SHA. The
   request has count one, Fargate, public control-plane/image access, an idempotency token, and no
   `overrides` property.
4. `Execute` accepts only that checksum-reviewed descriptor, submits it through
   `--cli-input-json`, first conditionally creates an immutable customer-KMS execution claim in
   the versioned state bucket, writes a local receipt immediately, waits for `STOPPED`, and
   requires the exact image digest, exit code `0`, no effective override, four aggregate-only
   success messages, zero active migration tasks, and zero ECS services.
5. `Verify` repeats the task/log/zero-compute checks and retains a refresh-backed zero-drift plan
   plus its adjacent `.baseline.json` sidecar. The operator rejects overwrites, removes only newly
   created plan/sidecar bytes if any validation or write fails, and requires state lineage/serial
   to remain unchanged while producing the handoff. The version-2 sidecar binds the exact current
   Terraform variable inventory, merged source, account, region, state lineage/serial, document
   stage, parser-version pin, reviewed document-publication receipt, immutable migration-image
   digest, plan path/hash, Terraform `1.9.8`, nonapplyable shape, zero meaningful resource/output
   changes, and only the bounded provider refresh records. Retain the printed `BaselinePath`,
   `BaselineSha256`, `BaselineMetadataPath`, and `BaselineMetadataSha256` for the next separately
   reviewed `CompleteDark` or gateway release; do not substitute the consumed migration task plan.

If the local waiter exits after a durable claim and ECS submission, never call `Execute` again.
Use `Recover` with the exact submitted receipt and reviewed descriptor. It has no submission path;
it accepts only the exact claimed task already stopped with exit `0`, the four aggregate success
records, and zero remaining migration compute, then finalizes the existing receipt for `Verify`.

Run `Get-Help` through the script's `-Help` switch for exact commands. Never reuse an execution
descriptor for a different task plan or image. The durable claim is never removed automatically,
so an ambiguous submission cannot become eligible for replay by deleting a local receipt or
waiting for the ECS client-token window to expire. Retain the receipt, inspect that exact task, and
do not generate a second descriptor or retry blindly.

## Execute once

Resolve the cluster, task-definition ARN, two reviewed migration subnets, and application security
group from Terraform outputs. Start exactly one Fargate task with a public IP only for bounded
control-plane/image access. Wait for `STOPPED`, require the `database-migration` container exit
code `0`, and retain only the sanitized success event.

Do not retry an unknown or failed migration blindly. Inspect the task stop reason and aggregate
logs, determine whether its transaction committed, and review a recovery migration when state is
ambiguous.

## Acceptance

- Every service-owned migration runner verifies its expected versions/checksums and schema
  invariants, and the orchestrator reports aggregate success only after all owners pass.
- No restricted value or candidate identifier appears in logs or evidence.
- Zero migration tasks remain running.
- API `200/200/401`, preference persistence, durable completion, and alarms remain healthy.
- The exact migration digest remains available for replay in the environment-local repository.
- A refresh-backed Terraform plan reports zero drift.
