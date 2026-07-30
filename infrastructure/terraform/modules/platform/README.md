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

Defaults implement the lean-until-demand profile: one task per service, Single-AZ PostgreSQL,
optional Redis, restricted public-subnet application egress, and no Application Load Balancer.
The same module exposes explicit replica, private-networking, cache, database-class, and
high-availability inputs so scaling is a reviewed configuration change.

The module also creates a KMS-encrypted operational SNS topic, alarm/OK actions, a log-derived
application-error metric, a dedicated alert-delivery canary, and an operational dashboard. Email
or other human destinations are subscribed outside Terraform so addresses do not enter source,
plans, or state. The alert operator script retains only aggregate subscription state.

When tracing is enabled, each gateway/worker task receives one digest-pinned, non-essential ADOT
sidecar. Applications export OTLP only over task-local loopback; the collector exports traces to
X-Ray through a two-action bounded task policy. Collector failure does not stop the application,
and the sidecar restart policy retries it without adding another ECS service or replica. ECS
invokes the image's bundled `/healthcheck` binary directly because the minimal collector image
does not contain a command shell.
