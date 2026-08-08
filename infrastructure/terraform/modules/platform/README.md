# Platform Module

Creates the lean AWS platform: VPC/subnets, encrypted RDS, S3 artifacts, SQS/DLQs, KMS, API
Gateway, Lambda request handling, Lambda durable workflows, alarms, budgets integration points,
and a one-off ECS/Fargate database-migration capability.

The request and workflow runtime is serverless. `deploy_gateway_lambda`,
`deploy_serverless_outbox`, and `deploy_profile_readiness_durable` allow immutable artifacts to be
deployed dark. `serverless_runtime_enabled` is the steady-state route/trigger kill switch: when
false, the Lambda integration remains deployable but no public route or workflow trigger is active;
when true, the JWT-protected default route, two public health routes, SQS starter, reconciler
schedule, and terminal-recovery rule activate together. There is no ECS or Temporal fallback.

The gateway and reconciler are the only producers for the platform-CMK-encrypted outbox queue.
The durable orchestrator is outside the VPC and invokes an exact activity version; database
activity and terminal handlers remain private and retrieve only the database secret. A narrow
Terraform-owned CloudFormation stack is retained because the AWS provider does not expose the
durable function's checkpoint KMS input.

`aws_ecr_repository.migration` is the only application container repository. It is immutable,
scan-on-push, and KMS encrypted. A nonempty `migration_image` creates a one-off Fargate task
definition and must reference an exact digest in that repository. The task has no listener, uses
the existing application security group, retrieves only `DATABASE_URL`, and exits after applying
and verifying versioned PostgreSQL migrations. The ECS cluster itself has no continuously running
service.

The lean defaults keep PostgreSQL Single-AZ, Redis absent, and NAT absent until measured or launch
evidence justifies expansion. Lambda concurrency and database-handler concurrency remain bounded
to protect the small database. Logs, native traces, queue age, DLQs, Lambda errors/throttles, RDS
capacity, and notification delivery remain visible through encrypted CloudWatch/SNS resources.

The retired gateway/worker ECS services, task definitions, Cloud Map, VPC Link, container
heartbeat alarms, gateway/worker ECR repositories, Temporal secret, and application task role are
not part of this module. Historical cutover evidence remains in delivery records and ADRs; it is
not an executable recovery path.
