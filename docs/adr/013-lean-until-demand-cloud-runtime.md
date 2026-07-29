# ADR-013: Lean-Until-Demand Cloud Runtime

Status: Accepted
Date: 2026-07-28

## Context

ADR-007 selected isolated AWS environments and a production-shaped, multi-AZ ECS platform. That
shape preserves a strong scale path, but running duplicate application tasks, replicated cache,
Multi-AZ PostgreSQL, per-AZ NAT gateways, and an Application Load Balancer before the product has
users would provision capacity without evidence that it improves product quality.

The platform still needs stable HTTPS ingress, managed durable storage, encrypted secrets,
observable failures, tested backups, and deployment isolation. Lean capacity must not weaken
factuality, authorization, privacy, workflow durability, idempotency, or recovery controls.

## Decision

Use AWS `us-east-2` as the primary region and keep the continuously running cloud footprint lean
through every pre-launch delivery and after launch until measured demand or an explicit risk
assessment justifies scaling.

- Provision one shared development environment first. Keep the staging account and Terraform
  composition isolated and ready, but provision staging on demand for release candidates,
  destructive migration rehearsals, restore exercises, security acceptance, and launch.
- Use regional API Gateway HTTP APIs, VPC Link, and AWS Cloud Map service discovery as the initial
  stable HTTPS path to private service identities. Do not provision an Application Load Balancer
  initially.
- Run one gateway task and one workflow-worker task by default. Add the web service when its cloud
  runtime enters scope, also with one task by default.
- Use a Single-AZ PostgreSQL instance with encryption, automated backups, point-in-time recovery,
  deletion protection, and restore testing. Multi-AZ is an opt-in capacity/availability change.
- Do not provision Redis until a measured cache, distributed rate-limit, or lease requirement
  exists. PostgreSQL remains durable truth.
- Permit a public-subnet Fargate task to have a public egress address in the lean profile only when
  its security group accepts application traffic exclusively from the API Gateway VPC Link. Move
  tasks to private subnets with NAT or approved private egress when risk, traffic, or launch review
  requires it.
- Preserve at least two subnets for data-service requirements and later availability changes, but
  do not duplicate NAT gateways or application replicas without evidence.
- Keep container images immutable, services stateless, migrations repeatable, API/event contracts
  stable, workflows durable, and data ownership independent of the deployment profile.
- Add capacity or availability only in response to recorded signals such as sustained CPU or
  memory pressure, latency/error-budget consumption, queue age, connection saturation, recovery
  objectives, provider limits, security review, or launch acceptance.

The lean profile controls provisioned capacity, not engineering quality. Every phase continues to
require tests, observability, bounded retries, idempotency, backups, deletion/export behavior,
security/privacy gates, and safe degradation.

## Scale path

Scaling is incremental and does not require changing client contracts:

1. Increase ECS desired counts and add target-tracking policies.
2. Move application tasks to private subnets and add per-AZ egress.
3. Enable Multi-AZ PostgreSQL and an optional replicated Redis service.
4. Add an ALB behind API Gateway when routing, connection behavior, or traffic evidence requires
   it.
5. Add dedicated services, search infrastructure, browser pools, or regions only when their
   ownership, failure isolation, or workload warrants them.

## Consequences

Pre-launch and early-launch infrastructure has lower fixed cost and fewer idle failure surfaces.
Single-instance and Single-AZ failures may create development or early-service downtime, so the
platform must report that posture honestly and retain restart, backup, restore, and reconciliation
evidence. Staging and high-availability capacity remain available as deliberate configuration
changes rather than architectural migrations.

This ADR supersedes ADR-007 only for primary region, initial ingress, default replica counts,
initial data-service availability, and continuous staging provisioning. ADR-007's account/state
isolation, encryption, managed-service, immutable-image, and fail-closed deployment requirements
remain accepted.

## Alternatives

- Keep the original production-shaped footprint from the first deployment. Rejected because it
  provisions unused capacity without improving the unproven product workflow.
- Use one EC2 instance with a static address. Rejected because it couples deployment, patching, and
  later scaling more tightly than the existing container and managed-data boundaries.
- Expose a Fargate task address directly. Rejected because task replacement changes the endpoint
  and does not provide an appropriate stable public contract.
