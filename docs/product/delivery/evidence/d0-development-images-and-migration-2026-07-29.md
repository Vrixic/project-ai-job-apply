# D0 Development Images and Database Migration Evidence — 2026-07-29

## Scope

This record covers immutable gateway/worker image publication and the controlled profile-foundation
database migration in the dedicated AWS development account in `us-east-2`. It proves the scanned
images exist and the one-off migration completed against the private RDS instance. Applications
remained disabled throughout.

It does not prove gateway or worker service deployment, API Gateway or Cloud Map behavior, deployed
Auth0 validation, Temporal workflow execution, alert delivery, rollback, PostgreSQL restore,
on-demand staging rehearsal, or Phase 0 completion.

## Reviewed source and remote checks

- The controlled migration task and replay-safe migration runner were reviewed in
  [PR #12](https://github.com/Vrixic/project-ai-job-apply/pull/12), merged as
  `ba8557c97b5a12a4c13c8557ac3dd6683af0b2f2`.
- Its repository quality, dependency audit, PostgreSQL integration, three container builds,
  Semgrep, and Terraform validation passed in
  [CI run 30496098574](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30496098574),
  [static-analysis run 30496098562](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30496098562),
  and [Terraform run 30496098571](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30496098571).
- The first cloud attempt exposed a missing TLS requirement in the Terraform-managed database URL.
  RDS rejected the unencrypted session before the migration transaction began. No schema change was
  claimed from that attempt.
- The managed TLS correction was reviewed in
  [PR #13](https://github.com/Vrixic/project-ai-job-apply/pull/13), merged as
  `b1483d4c188c5e16829cf03bafef299a66825aeb`. Its repository quality, integration,
  container, dependency, static-analysis, and Terraform checks all passed.

## Immutable image evidence

[Development image publication run 30496688307](https://github.com/Vrixic/project-ai-job-apply/actions/runs/30496688307)
used GitHub OIDC and short-lived AWS credentials to build and publish source revision
`ba8557c97b5a12a4c13c8557ac3dd6683af0b2f2`.

| Image | OCI index digest | `linux/amd64` manifest digest | ECR scan |
|---|---|---|---|
| Gateway | `sha256:c19ba6b7d52749432b9055ed2b950c481b40065f880da8a2f5f032910d969d35` | `sha256:978453c8dd813494c42617d6cc890660a14625261b82ad3d59e88296d6bd8277` | `COMPLETE`; critical 0, high 0, medium 0, low 0 |
| Worker | `sha256:b2358547cb40c654987c69e5721a1643f062be2d7c79c7fdb0adff3ab29e7b0c` | `sha256:085e6d18c9d8d712bb961ac9d532674ded6faf442c19b26eeb4bae2198e03ce2` | `COMPLETE`; critical 0, high 0, medium 0, low 0 |

The one-off migration used the exact gateway `linux/amd64` manifest digest shown above, not a
mutable tag.

## Reviewed plans and applies

Terraform `1.9.8` ran through the temporary
`ai-job-apply-development-admin` IAM Identity Center profile. Caller, account, region, remote state,
and ECR repository alignment passed without recording account identifiers.

1. The migration-task plan had SHA-256
   `8DE2C0937F76E248BADA2512DFD055CE67DB19C65F28B0F512496D2043086B32`.
   It created only `module.platform.aws_ecs_task_definition.migration[0]`, contained zero
   destructive actions, used the approved digest, and kept `deploy_applications=false`.
2. After the rejected non-TLS attempt, the correction plan had SHA-256
   `D592AFAAAD1C2CB1CA13BA6A59D27AD5E38491D4CB27C94CD566FAE7CB9D74DB`.
   It replaced only the managed database secret version to add `sslmode=require`; it did not
   replace RDS, rotate database credentials, or modify persistent data, and it kept applications
   disabled.
3. Both exact reviewed plans applied successfully. Refresh-backed plans after each apply reported
   no changes. The local saved plans were deleted after their hashes and results were recorded.

The managed secret was inspected only in process memory. Verification confirmed TLS is required
without printing the database URL, endpoint, username, password, secret identifier, or raw state.

## Migration and disabled-application verification

The replacement one-off Fargate task:

- started without ECS placement failures;
- ran the approved `linux/amd64` image digest;
- reached `STOPPED` with container exit code `0`;
- emitted exactly one encrypted CloudWatch application-log event:
  `Database migration 0001_foundation applied and verified.`; and
- left zero ECS services, zero platform API Gateway APIs, and zero platform Cloud Map namespaces.

The migration transaction uses an advisory lock, a version/checksum journal, and expected-table
verification. CI also ran the compiled migration twice against PostgreSQL and verified replay
behavior. No task ARN, account ID, network identifier, database value, secret value, or raw log
payload is retained here.

## Remaining acceptance

- Review and deploy the applications-enabled gateway/worker plan with exact managed Auth0 and
  Temporal prerequisites.
- Prove deployed authentication, owner isolation, persistence, outbox dispatch, Temporal
  completion, populated telemetry/redaction, and alert delivery.
- Exercise rollback and an isolated PostgreSQL restore, then rehearse staging on demand.
- Complete remaining accountable legal/privacy and security/privacy approvals.
