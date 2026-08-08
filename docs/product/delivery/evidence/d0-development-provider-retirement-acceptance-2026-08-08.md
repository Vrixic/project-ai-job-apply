# D0 development provider-retirement acceptance — 2026-08-08

## Scope

Development account `362544434697` in `us-east-2` retired the remaining Temporal credential and
legacy gateway/worker container artifacts. The retained API Gateway/Lambda runtime, durable
workflow triggers, RDS/backups, KMS, S3 artifacts, queues/DLQs, alarms, ECS migration cluster, and
dedicated migration capability remained outside the deletion boundary.

The exact migration image remained:

`362544434697.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:0a205c0b2341cbae91a8974354fb7b1017052b679b60b01ca10c3b6dbc33235d`

## Provider and database retirement

- Migration `0003_retire_legacy_dispatch` completed with exit code `0` from the retained one-off
  migration task and made `lambda_durable` the only active dispatch target.
- The exact development Temporal credential returned the accepted access-rejection result after
  revocation. No credential value, workflow identifier, or candidate identifier was printed.
- The gateway and worker repositories contained 18 manifests each before their explicitly
  authorized purge and zero afterward. ECR manifest-list dependencies required bounded idempotent
  passes; each pass remained limited to those two repositories.

## Cleanup execution and recovery

The first cleanup plan, SHA-256
`09ba8fa41d0475153d887055438627f2af36bf941264fa92c5d470339f9f90f8`, contained zero creates,
two least-privilege policy updates, five deletes, and zero replacements. It applied the policy
updates and deleted the empty gateway/worker repositories, obsolete application IAM role, and
Temporal secret container. Secrets Manager scheduled the revoked secret for deletion with its
30-day recovery window.

Deletion of the obsolete ingress security group failed closed because one historical TCP/4000
source-group rule remained on the retained application security group. The consumed plan was not
replayed and no manual AWS mutation bypassed Terraform. PR
[#193](https://github.com/Vrixic/project-ai-job-apply/pull/193) made the Lambda application group
explicitly own an empty ingress set and introduced an exact two-change recovery guard.

The product owner separately authorized recovery-plan SHA-256
`051d40a5457d88212e3109c396f0a6e96f7b3364df129fa6598c0b95c0065270`. It applied from merged
commit `8641a9ec3f0915ef6a5b9f7df5cc5b82bb322d5d` with zero additions, one update removing only the
historical ingress rule, one deletion of the obsolete group, and zero replacements.

## Final verification

The guarded development verifier and independent AWS inspection proved:

- refresh-backed Terraform zero drift;
- public Lambda API `200/200/401` liveness, readiness, and anonymous protected-route behavior;
- enabled durable triggers;
- the Temporal secret absent or scheduled for deletion;
- gateway and worker repositories absent;
- obsolete application IAM role and ingress security group absent;
- retained application security group with zero inbound rules;
- the exact scanned migration image and one-off migration capability retained.

Development provider retirement is accepted. This evidence does not complete SR-009 or D0-016:
staging requires its separately reviewed migration, key revocation, artifact/AWS cleanup, final
verification, and executable repository cleanup before the shared task can close.
