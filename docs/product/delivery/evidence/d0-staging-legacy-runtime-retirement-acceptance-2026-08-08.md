# D0 staging legacy runtime retirement acceptance — 2026-08-08

## Accepted change

The product owner authorized staging plan SHA-256
`89866f50d65ff5867e495e7b4966d86040d44a7592ad673c2496ba428774927d` after the
rollback window expired. The saved refresh-backed plan contained zero creates, one operations-
dashboard update, 13 deletes, and zero replacements. Terraform applied that exact saved plan
without replanning.

The deleted boundary was limited to the legacy HTTP proxy integration, VPC Link, Cloud Map
namespace/service, gateway and workflow-worker ECS services/task definitions, application tracing
policy, and two heartbeat metric-filter/alarm pairs. RDS, S3, SQS/DLQ, KMS, backups, ECR migration
capability, the ECS cluster and on-demand migration task, Secrets Manager containers, API Gateway's
Lambda integration, durable functions/triggers, serverless alarms, budgets, and cost exports were
retained.

## Automated verification

The guarded post-apply verifier passed in the isolated staging account:

- the exact saved-plan checksum remained bound to the apply;
- a fresh refresh-backed plan reported zero drift;
- public Lambda liveness and readiness returned `200`;
- the protected route returned `401` without a token;
- the alias-qualified SQS event-source mapping and both durable EventBridge rules remained enabled;
- the on-demand database-migration task remained available; and
- obsolete ECS services/task definitions, HTTP proxy integration, VPC Link, Cloud Map, tracing
  policy, and heartbeat alarms/filters were absent.

The merged `lambda-retired` launcher independently repeated the AWS/Terraform/Auth0/Lambda/JWT/
durable/retired-inventory preflight before starting the staging BFF.

## Authenticated acceptance

The aggregate BFF request log recorded a successful authenticated preference load and save,
successful operation-status reads, a non-disclosing absent preference response for the second
account, and successful isolation arm/run requests. The log contained no stderr output. The
product owner confirmed that the second account could not read the first account's operation.

No candidate value, identity, operation identifier, token, cookie, response body, account number,
state-bucket name, or other sensitive infrastructure identifier is retained in this record.
Staging legacy-runtime retirement is accepted.
