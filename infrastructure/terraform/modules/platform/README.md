# Platform Module

Creates the AWS network, encrypted data services, queues, ECS cluster, registries, application
task definitions, API Gateway/Cloud Map ingress, and alarms. Application services remain disabled
until a managed OIDC issuer, Temporal, and immutable container images are supplied.

The persistent layer creates encrypted database and empty Temporal API-key secret destinations.
Terraform owns the database value; an operator writes the Temporal API key directly to its empty
secret only after the persistent apply succeeds.

A scanned immutable `migration_image` creates only a one-off Fargate task definition. This permits
the reviewed database migration to run before API Gateway, Cloud Map, gateway, or worker services
are enabled. The migration task has no public listener and receives the database URL directly from
Secrets Manager.

Defaults implement the lean-until-demand profile: one task per service, Single-AZ PostgreSQL,
optional Redis, restricted public-subnet application egress, and no Application Load Balancer.
The same module exposes explicit replica, private-networking, cache, database-class, and
high-availability inputs so scaling is a reviewed configuration change.
