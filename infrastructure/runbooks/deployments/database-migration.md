# Database Migration

Run schema changes through the retained one-off ECS/Fargate migration task. The ECS cluster has no
service and must return to zero running tasks after every migration.

## Preconditions

- Use exact merged source, Terraform `1.9.8`, and the selected environment's temporary IAM
  Identity Center profile in `us-east-2`.
- Confirm RDS is available, encrypted, deletion protected, and covered by current backups/PITR.
- Build only `Dockerfile.migration`; push it to the environment-local immutable, KMS-encrypted,
  scan-on-push `ai-job-apply/migration` repository.
- Require the exact platform digest to have a complete scan with zero High or Critical findings.
- Review the SQL for transactional behavior, replay safety, bounded locks, data classification,
  downgrade/forward-recovery strategy, and aggregate-only observability.

## Deploy the task definition

Create a refresh-backed Terraform plan with the exact digest URI. The plan may replace only the
one-off migration task definition and narrow execution-secret policy when required. Review and
apply its exact SHA-256. Require a read-only root filesystem, non-root image user, Fargate,
`awsvpc`, the migration command, and only the database secret.

## Execute once

Resolve the cluster, task-definition ARN, two reviewed migration subnets, and application security
group from Terraform outputs. Start exactly one Fargate task with a public IP only for bounded
control-plane/image access. Wait for `STOPPED`, require the `database-migration` container exit
code `0`, and retain only the sanitized success event.

Do not retry an unknown or failed migration blindly. Inspect the task stop reason and aggregate
logs, determine whether its transaction committed, and review a recovery migration when state is
ambiguous.

## Acceptance

- The migration runner verifies every expected version/checksum and schema invariant.
- No restricted value or candidate identifier appears in logs or evidence.
- Zero migration tasks remain running.
- API `200/200/401`, preference persistence, durable completion, and alarms remain healthy.
- The exact migration digest remains available for replay in the environment-local repository.
- A refresh-backed Terraform plan reports zero drift.

