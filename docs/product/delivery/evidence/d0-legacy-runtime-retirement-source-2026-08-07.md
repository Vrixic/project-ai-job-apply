# D0 legacy runtime retirement source evidence — 2026-08-07

## Decision

The product owner explicitly expired the development and staging legacy ECS rollback windows at
`2026-08-08T02:56:32.831Z`. Both environments had already passed routed Lambda persistence,
durable-workflow completion, exact replay, two-account isolation, rollback/restoration, fixed
workload, empty-work, alarm/log, and refreshed zero-drift evidence. Expiry starts SR-008; it does
not itself delete infrastructure.

## Implemented source boundary

- `retain_legacy_ecs_rollback` defaults to `false` in development and staging.
- `legacy_ecs_rollback_expired_at` records the exact decision in both environment compositions.
- The platform removes the old HTTP proxy integration, VPC Link, Cloud Map namespace/service,
  gateway and worker ECS services/task definitions, application tracing policy, and two heartbeat
  filters/alarms only when retention is false.
- The operations dashboard removes ECS/heartbeat panels and gains serverless Lambda invocation,
  error, and throttle signals.
- The shared operator and fixed environment wrappers rehydrate the last accepted zero-change
  serverless plan, bind the exact account/state/source/expiry, and permit exactly 13 deletes, one
  dashboard update, zero creates, and zero replacements.
- Apply requires the exact reviewed plan checksum, `-ConfirmRollbackExpired`, and `-Execute`.
  Post-apply verification requires fresh zero drift, public health `200/200`, anonymous protected
  route `401`, enabled durable triggers, retained migration capability, and direct absence of the
  obsolete AWS inventory.

RDS, S3, SQS/DLQ, KMS, backups, ECR repositories, the ECS cluster, the on-demand migration task,
Secrets Manager containers, API Gateway/Lambda durable runtime, serverless alarms, budgets, and
cost exports are explicitly outside this retirement plan. Temporal credential/provider and
obsolete repository cleanup remain separate SR-009 work.

## Local verification

- Terraform 1.9.8 validation passes for development and staging.
- PowerShell parsing and help output pass for the shared operator and both wrappers.
- Infrastructure policy validation and Terraform formatting pass.
- A refresh-backed development preview generated from the accepted runtime inputs produced exactly
  `0` creates, `1` dashboard update, `13` deletes, and `0` replacements.
- The operator's local `Status` semantic guard accepted that exact preview and rejected broader
  action shapes by construction.
- No Terraform apply, ECS task, route change, queue operation, product-data write, secret read, or
  AWS resource deletion occurred while producing this source evidence.

## Remaining acceptance

1. Merge the source as one batched Phase 0 change.
2. Generate fresh clean-main plans separately in development and staging.
3. Review and explicitly authorize each exact plan checksum.
4. Apply one environment at a time and require automated zero drift/inventory/API checks.
5. Repeat authenticated preference readiness and two-account isolation conformance.
6. Record final inventories before beginning separately reviewed SR-009 provider/repository cleanup.
