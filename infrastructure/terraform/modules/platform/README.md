# Platform Module

Creates the AWS network, encrypted data services, queues, ECS cluster, registries, application
task definitions, API Gateway/Cloud Map ingress, and alarms. Application services remain disabled
until a managed OIDC issuer, Temporal, and immutable container images are supplied.

API Gateway reaches the gateway through Cloud Map service discovery. The gateway uses an `SRV`
record so ECS registers both the task IP and container port required by API Gateway's
`DiscoverInstances` integration.

The persistent layer creates encrypted database and empty Temporal API-key secret destinations.
Terraform owns the database value and requires TLS in its managed connection string; an operator
writes the Temporal API key directly to its empty secret only after the persistent apply succeeds.

A scanned immutable `migration_image` creates only a one-off Fargate task definition. This permits
the reviewed database migration to run before API Gateway, Cloud Map, gateway, or worker services
are enabled. The migration task has no public listener and receives the database URL directly from
Secrets Manager. RDS rejects unencrypted database sessions, and the managed URL explicitly enables
TLS for the migration, gateway, and worker clients.

When the private Secrets Manager endpoint is present, its policy admits only the exact Lambda
database roles and the environment's ECS execution role. The ECS role can retrieve only the
environment database and Temporal secrets, preserving bounded migration/inspection tasks and the
retained ECS rollback path after private DNS begins routing secret retrieval through the endpoint.

Defaults implement the lean-until-demand profile: one task per service, Single-AZ PostgreSQL,
optional Redis, restricted public-subnet application egress, and no Application Load Balancer.
The same module exposes explicit replica, private-networking, cache, database-class, and
high-availability inputs so scaling is a reviewed configuration change.

Gateway, workflow-worker, and migration task-definition replacements create the new immutable
revision before deregistering the Terraform-managed prior revision. Long-running services update
to the new revision between those operations, preserving the running release and its rollback
target throughout the change.

The module also creates a KMS-encrypted operational SNS topic, alarm/OK actions, a log-derived
application-error metric, a dedicated alert-delivery canary, and an operational dashboard. Email
or other human destinations are subscribed outside Terraform so addresses do not enter source,
plans, or state. The alert operator script retains only aggregate subscription state.

When applications are enabled, separate gateway and workflow-worker metric filters count their
fixed log-delivery heartbeats. Three consecutive missing one-minute datapoints alarm through the
same encrypted topic, so a silent service/log path is detectable independently from error logs.
The development recovery drill can deny only the gateway stream prefix while the worker remains
unaffected.

When tracing is enabled, each gateway/worker task receives one digest-pinned, non-essential ADOT
sidecar. Applications export OTLP only over task-local loopback; the collector exports traces to
X-Ray through a two-action bounded task policy. Collector failure does not stop the application,
and the sidecar restart policy retries it without adding another ECS service or replica. ECS
invokes the image's bundled `/healthcheck` binary directly because the minimal collector image
does not contain a command shell. The essential gateway container separately runs a direct Node
liveness check so ECS task health and Cloud Map registration reflect the application rather than
the nonessential telemetry sidecar.

The D0-016 serverless workflow resources are disabled by default. When explicitly configured with
three immutable, versioned artifacts, the module can dark-deploy one-concurrency starter,
reconciler, database-activity, and terminal-recovery Lambdas; a two-concurrency durable
orchestrator; private Secrets/SQS/Lambda endpoints; a dedicated encrypted terminal DLQ; and
replacement alarms. The durable orchestrator is intentionally outside the VPC and invokes only
the exact numeric activity version. Database handlers remain private and obtain the database value
through the pinned regional Secrets extension.

The gateway and reconciler are the only producers for the platform-CMK-encrypted outbox queue.
Each receives `sqs:SendMessage` on that queue and the producer-required `kms:Decrypt` plus
`kms:GenerateDataKey` permissions on the exact platform key. The starter remains a consumer and
receives no data-key generation permission.

Terraform owns a single nested CloudFormation stack for the durable function, version, and alias
because the pinned AWS provider does not yet expose `DurableConfig.KMSKeyArn`. That narrow boundary
keeps checkpoint encryption declarative and drift-visible; superseded durable versions use retain
policies so in-flight executions remain replayable. All other resources remain native Terraform.

`deploy_profile_readiness_durable` and `deploy_serverless_outbox` create the dark replacement.
`serverless_runtime_cutover` defaults to `false` and atomically controls the API Gateway Lambda
integration and routes, the gateway's `lambda_durable` new-event target, the SQS starter mapping,
the reconciliation schedule, and the terminal-event rule. The module rejects cutover unless the
complete replacement is deployed and the retained ECS rollback services are configured idle.
