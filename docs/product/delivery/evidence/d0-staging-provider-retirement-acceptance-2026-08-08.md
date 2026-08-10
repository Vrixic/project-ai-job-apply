# D0 staging provider-retirement acceptance — 2026-08-08

## Scope

Synthetic staging account `908203540025` in `us-east-2` retired its remaining external workflow
credential and legacy gateway/worker container artifacts. RDS/backups, KMS, S3 artifacts,
queues/DLQs, API Gateway, Lambda functions/aliases, durable state, alarms, budgets/exports, the
empty ECS migration cluster, and the dedicated migration capability remained outside the deletion
boundary.

The retained migration image is:

`908203540025.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:26c8c8f745691b3fc1a9472cc2e27cfa5d287d63be419d4b92a0893eaf922cd6`

Its ECR scan completed with zero Critical and zero High findings.

## Provider and database retirement

- Migration-task plan
  `b6ed987cb2629783b5462a4ed828aa5902c3269c9a51e51799d6cc1cc45e7e67`
  replaced exactly the one-off migration task definition with the reviewed platform digest.
- Migration `0003_retire_legacy_dispatch` ran once, stopped with exit code `0`, emitted exactly one
  sanitized verification event and zero error-like events, and left zero running tasks. Its
  transaction fails closed on unpublished legacy rows, relabels only published history, and makes
  `lambda_durable` the sole active dispatch target.
- The exact AWS-managed staging credential was rejected by the provider after a short propagation
  interval. The accepted verification printed no credential, namespace, workflow, account, or
  candidate identifier.
- The gateway and worker repositories each contained nine manifests. OCI index dependencies
  required bounded idempotent passes; all 18 legacy manifests were permanently removed while the
  migration repository remained intact.

## Cleanup execution

Cleanup plan SHA-256
`aa9fad2a53cb19b79746ec767a6e6e116f916861ebdf2dd9f8e588ea774230e2`
contained zero creates, three in-place least-privilege/security updates, five deletes, and zero
replacements. The exact reviewed plan applied successfully without recovery:

- deleted the empty gateway and worker repositories;
- deleted the obsolete application task role and ingress security group;
- scheduled the revoked provider secret container for deletion under its recovery window;
- removed the historical TCP/4000 application ingress; and
- narrowed the execution-secret and Secrets Manager endpoint policies.

No database, backup, key, bucket, queue, Lambda, API, durable-state, budget/export, or migration
resource was deleted or replaced.

## Final verification

The guarded verifier and independent AWS inspection proved:

- refresh-backed Terraform zero drift;
- public Lambda API `200/200/401` liveness, readiness, and anonymous protected behavior;
- enabled SQS and EventBridge durable triggers;
- absent gateway/worker repositories, obsolete application role, and obsolete ingress group;
- the retained application security group has zero inbound rules;
- the revoked secret is scheduled for deletion;
- the exact scanned migration repository/task remains available; and
- the ECS cluster has zero application services and zero running tasks.

The product owner then completed fresh post-retirement browser acceptance: preferences saved,
readiness reached `succeeded`, the saved preference persisted through logout/reauthentication, and
a distinct synthetic account received only the sanitized cross-user isolation pass.

Staging provider retirement is accepted. The subsequent maintained-repository cleanup is recorded
separately; D0-016 remains open only for post-cutover two-account billing reconciliation. This
record does not constitute legal, privacy, security, or production approval.
