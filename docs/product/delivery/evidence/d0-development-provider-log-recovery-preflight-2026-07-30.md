# D0 Development Provider And Log Recovery Preflight — 2026-07-30

## Scope

This record covers repository implementation and local validation for the final D0-010
provider/log-stream recovery exercise. It is preflight evidence only. No Auth0 connection, AWS IAM
permission, application image, ECS service, CloudWatch resource, or Terraform-managed resource was
changed while producing it.

## Implemented boundary

- Gateway and workflow worker emit the same fixed `log_delivery_heartbeat` event every 30 seconds.
  The logger supplies only service/release metadata; the heartbeat accepts no request, identity,
  candidate, preference, operation, provider, or credential input.
- Shutdown stops each timer before the service closes its dependencies.
- Two application-specific CloudWatch metric filters count the gateway and worker events.
- Two three-of-three one-minute alarms treat missing continuous data as breaching and route both
  ALARM and OK through the existing encrypted operational topic.
- The operations dashboard includes both heartbeat metrics only when applications are enabled.
- A development-only operator resolves the exact running gateway execution role and log group,
  temporarily denies only `logs:PutLogEvents` for the `gateway/*` stream prefix, verifies the API
  remains live, removes the deny in a `finally` block, and supports an independent exact recovery
  action.
- A separate Auth0 procedure disables only the exact web application's enabled connections,
  verifies fresh login cannot complete, restores the exact prior set, and requires a fresh passkey
  login plus durable operation after recovery.

The Auth0 exercise does not claim that existing sessions or issued tokens are revoked, and the log
exercise does not claim to isolate a CloudWatch regional outage. Together they prove the
application's controlled dependency-failure behavior without a test-token bypass.

## Design basis

- Auth0 documents application-scoped connection enable/disable through the application's
  **Connections** tab:
  <https://dev.auth0.com/docs/get-started/applications/update-application-connections>.
- Amazon ECS documents that the task execution role is used by the ECS/Fargate agent for
  `awslogs`, including `logs:PutLogEvents`:
  <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html>.
- CloudWatch documents `breaching` missing-data treatment for a metric expected to report
  continuously:
  <https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html>.
- CloudWatch Logs documents that metric filters publish only when log data is ingested and the
  pattern matches when no default value is configured:
  <https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html>.

## Local verification

Passed:

- PowerShell parser validation for the exact log-delivery operator;
- observability tests: 3 files and 15 tests;
- observability build;
- gateway type check;
- workflow-worker type check;
- complete repository skills, format, lint, type-check, and test gate;
- complete Phase 0 verification including contract regeneration, production builds, Compose
  validation, and removed-scope scan;
- Terraform formatting;
- development Terraform initialization without a backend and validation; and
- staging Terraform initialization without a backend and validation.

The refresh-backed deployment plan remains required after immutable images are published from the
merged commit.

## Deployment and exercise gates

Still open:

1. merge the reviewed repository change;
2. publish and scan immutable gateway and worker images from the merge commit;
3. save and inspect a refresh-backed Terraform plan containing only the two new task revisions,
   two service updates, two metric filters, two alarms, and dashboard update;
4. apply only that exact plan and require stable services, heartbeat metrics, both alarms `OK`, and
   no drift;
5. run the separate Auth0 fresh-login interruption/recovery procedure;
6. run the exact gateway log-delivery interruption/recovery operator;
7. confirm sanitized ALARM and OK notifications, worker-heartbeat continuity, clean logs, and no
   drift; and
8. create deployed evidence before changing D0-010 to complete.

No deployed outcome is claimed by this preflight.
