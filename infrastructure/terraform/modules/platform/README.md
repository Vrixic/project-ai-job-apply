# Platform Module

Creates the AWS network, encrypted data services, queues, ECS cluster, registries, application
task definitions, API Gateway/Cloud Map ingress, and alarms. Application services remain disabled
until a managed OIDC issuer, Temporal, and immutable container images are supplied.

Defaults implement the lean-until-demand profile: one task per service, Single-AZ PostgreSQL,
optional Redis, restricted public-subnet application egress, and no Application Load Balancer.
The same module exposes explicit replica, private-networking, cache, database-class, and
high-availability inputs so scaling is a reviewed configuration change.
