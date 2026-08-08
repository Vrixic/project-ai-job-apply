# D0 development legacy runtime retirement acceptance — 2026-08-07

## Accepted change

The product owner authorized development plan SHA-256
`ec1d6967718764b2ad208048603667ee3ddcd9693b824e74684deb48fd5338e3` after the
rollback window expired. The saved plan contained zero creates, one operations-dashboard update,
13 deletes, and zero replacements. Terraform applied that saved plan without replanning.

The deleted boundary was limited to the legacy HTTP proxy integration, VPC Link, Cloud Map
namespace/service, gateway and workflow-worker ECS services/task definitions, application tracing
policy, and two heartbeat metric-filter/alarm pairs. RDS, S3, SQS/DLQ, KMS, backups, ECR migration
capability, ECS cluster and on-demand migration task, Secrets Manager containers, API Gateway's
Lambda integration, durable functions/triggers, serverless alarms, budgets, and cost exports were
retained.

## Verification and recovery notes

The first post-apply verifier reached its read-only AWS inventory after apply and zero-drift
planning, then failed because it derived a nonexistent `-cluster` suffix. Direct inspection proved
the exact retained cluster and absence of active ECS services, gateway/worker task definitions,
VPC Links, and Cloud Map namespaces. The destructive plan was not retried.

Two later read-only verifier attempts exposed AWS response-shape assumptions: empty inventories may
omit their array property, and an unqualified Lambda function filter does not return an
alias-qualified event-source mapping. Each correction was source-reviewed, policy-guarded, merged,
and rerun without applying infrastructure. Direct AWS inspection throughout showed the exact
development alias-qualified SQS mapping in `Enabled` state with partial-batch handling and both
durable EventBridge rules `ENABLED`.

The final merged verifier passed:

- `LegacyRuntimeRetired: true`;
- fresh Terraform `NoDrift: true`;
- public Lambda API health `200/200`;
- anonymous protected-route status `401`;
- durable runtime and triggers retained;
- on-demand migration capability retained; and
- obsolete ECS/API proxy/VPC Link/Cloud Map/tracing/heartbeat inventory absent.

No candidate value, identity, token, secret, raw response, or infrastructure identifier is retained
in this record.

## Remaining acceptance

Run the `lambda-retired` browser launcher and confirm authenticated preference persistence,
readiness completion, and two-account isolation. Development retirement is otherwise complete.
Staging remains a separate plan/checksum/apply/verification boundary.
