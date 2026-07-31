# D0 Staging Database Migration Evidence — 2026-07-30

## Scope

This record covers provisioning and running the controlled profile-foundation database migration
in the isolated staging AWS account in `us-east-2`. It proves migration `0001_foundation` completed
and verified while all long-running applications remained disabled.

It does not prove staging Auth0 or Temporal configuration at the time of this execution, gateway
or worker deployment, authenticated workflows, observability delivery, restart, rollback,
restore, workload baselines, cost attribution, or Phase 0 completion. Subsequent evidence records
the isolated Temporal secret/read conformance.

## Reviewed source and image

- Terraform and migration source came from merged `main` commit
  `9ddbfcdad862ed87f792d184106a697044f291a6`.
- The migration used the exact gateway `linux/amd64` platform digest
  `sha256:552f1adf0f64c7ed7f572e0c2c2c983dde5426a87301fd0647c8198640a764bb`
  recorded in the [staging image evidence](d0-staging-images-2026-07-30.md).
- Its ECR scan was `COMPLETE` with zero critical and zero high findings before the task
  definition was planned.
- The migration command, advisory lock, version/checksum journal, transaction, and expected-table
  verification are part of the same reviewed image. The repository integration suite also proves
  replay-safe execution against PostgreSQL.

## Reviewed plan and apply

Terraform `1.9.8` ran through the staging IAM Identity Center profile against the existing
KMS-encrypted remote state. The refresh-backed saved plan had SHA-256
`DCA4A745D712FF7DEAB9CC160DA9A7F1FE1482695654C2B20560F9311EC5A537`.

The reviewed plan:

- created only `module.platform.aws_ecs_task_definition.migration[0]`;
- contained zero updates, replacements, or deletes;
- kept `deploy_applications=false`;
- pinned the approved platform digest;
- referenced the database URL only through the existing managed secret;
- used the exact compiled migration command, a read-only root filesystem, `awsvpc`, and the
  reviewed lean CPU/memory shape; and
- changed no ECS service, API Gateway resource, Cloud Map resource, persistent data resource,
  NAT, Redis, or load balancer.

The exact checksum-matched plan applied successfully. The task definition became `ACTIVE`, a
same-input refresh-backed plan reported no drift, and the consumed local plan was deleted because
Terraform plan files may contain sensitive state values.

## Migration execution and verification

Before launch, an in-memory secret check confirmed the managed PostgreSQL URL requires TLS without
printing the URL or any component. The initial local predicate incorrectly retained the URI
query's leading `?` and stopped before `run-task`; correcting the predicate caused no cloud or
database change.

The controlled launch then:

- submitted exactly one Fargate task from the active Terraform-managed task definition;
- used the approved immutable platform digest;
- encountered no placement failure;
- reached `STOPPED` with container exit code `0`;
- emitted exactly one encrypted CloudWatch application-log event:
  `Database migration 0001_foundation applied and verified.`; and
- emitted zero unexpected events in that migration stream.

The local status monitor timed out after submission, so verification recovered the existing task
by its controlled task-family and `startedBy` prefix. No duplicate task was submitted.

After execution:

- zero ECS services existed;
- zero ECS tasks remained running;
- staging applications remained disabled; and
- the final refresh-backed Terraform plan reported no drift.

No AWS account number, role ARN, database URL, credential, secret identifier/value, task
identifier, network identifier, repository URL, registry hostname, log-stream identifier, or raw
state is retained in this record.

## Remaining staging acceptance

- Use the isolated staging Temporal namespace/key and the exact development Auth0 issuer only
  under the temporary synthetic-only
  [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md) exception. This
  does not authorize real users or prove identity isolation.
- Review and apply the one-gateway/one-worker application plan.
- Replay identity, ownership isolation, workflow completion, logs/traces/alerts, restart,
  rollback, restore, workload, and cost-attribution evidence.
- Record no drift and return staging to its reviewed lean posture after acceptance.

Subsequent [staging Temporal-secret evidence](d0-staging-temporal-secret-2026-07-30.md) proves the
isolated namespace and managed key passed secret-safe read conformance.
