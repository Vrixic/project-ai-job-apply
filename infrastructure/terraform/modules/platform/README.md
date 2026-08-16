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
`persistent_data_plane_enabled` separates the hourly private database/endpoint data plane from the
retained serverless control plane. It defaults on for normal environments. A caller may disable it
only after traffic is quiesced and database deletion protection has been removed by a separate
reviewed apply. This generic switch is currently owned by synthetic staging under ADR-018; it is not
a production retention policy.

The optional D1 ingestion composition is separately deployable and remains dark by default:
`deploy_ingestion_runtime`, `ingestion_runtime_enabled`, and
`ingestion_synthetic_source_enabled` must be advanced deliberately in that order, and the shared
`runtime_activation_allowed` lifecycle authority must permit trigger activation. Its work queue
retains identifier-only nudges for four days. Its shared DLQ retains only value-free schedule,
terminal-metadata, durable-identifier, and nudge-failure envelopes for fourteen days and has no
automatic consumer or redrive. No
real-provider adapter, event-source mapping, schedule, or source is enabled by repository defaults.

`deploy_public_job_reader` can dark-provision one immutable public-reader Lambda with reserved
concurrency one. Its anonymous route exists only when the global serverless runtime, lifecycle,
and persistent-data gates are all active. The exact route has no authorizer, rate and burst are
frozen at one, and route 4xx/5xx plus Lambda error/throttle/duration alarms are required. The role
may connect only as `ai_job_apply_public_job_reader` to the exact RDS resource ID, receives no
database secret, and explicitly denies function code the VPC-management permissions retained for
the Lambda service. The role's exact-key KMS decrypt grant exists only for Lambda's automatic
environment decryption; a source-function condition explicitly denies that action to function
code. A versioned Jobs migration limits the identity's direct application-schema
projection access to the security-definer public function. Provisioning refuses any value except the exact
`public_job_database_boundary_version = "0006_public_job_reader"` attestation. Bootstrap-boundary
application, database migration, artifact publication, plan review, and abuse acceptance remain
separate prerequisites; defaults do not expose the route. RDS IAM tokens are not database-name
scoped, so this packet proves least privilege only inside the application database. PostgreSQL's
cluster-global PUBLIC catalog/function capabilities also remain outside this application migration;
the read-only session default is defense in depth, not an immutable deny. Accountable review must
accept or remediate both the other-database and catalog/function residuals, or approve a separately
guarded cluster-wide/dedicated-instance control, before route activation. The explicit
`public_job_cluster_residual_accepted` gate defaults false and keeps the route structurally absent
even when the deploy and global runtime switches are otherwise enabled.
