# ADR-017: Zero-Traffic Pre-Cutover ECS Idle Posture

Status: Accepted
Date: 2026-08-03

## Context

[ADR-016](016-scale-to-zero-application-runtime.md) originally keeps the gateway and Temporal
worker running until isolated staging and development complete their Lambda cutovers. That order
minimizes availability loss for an environment receiving traffic, but both Phase 0 environments
currently have no users, no required availability, and no authorized production data or external
application traffic. Continuously running the rollback-only tasks during the remaining migration
therefore adds Fargate compute and public IPv4 use without protecting a current user journey.

Stopping the tasks before cutover is safe only if pending durable work is absent, the unavailable
environment state is explicit, persistent infrastructure is retained, and returning to the old
runtime remains a separately reviewed reversible action. An ad hoc ECS console or CLI scale-down
would create unmanaged Terraform drift and could be silently reversed by a later plan.

## Decision

Amend ADR-016 with a zero-traffic pre-cutover idle stage for development and synthetic staging.

- The product owner must explicitly confirm that the environment has zero traffic and may be
  unavailable until its Lambda cutover.
- Before shutdown, require a bounded read-only PostgreSQL inspection with zero undispatched outbox
  rows and a privacy-safe Temporal visibility query with zero running workflows.
- Terraform retains both ECS services and their exact immutable task definitions but sets gateway
  and workflow-worker desired counts to zero through one explicit environment input. Do not use an
  out-of-band console or untracked CLI scale-down.
- Retain API Gateway, its current VPC Link/Cloud Map integration, ECS cluster, task definitions,
  images, RDS, queues, buckets, KMS keys, Secrets Manager containers, backups, Temporal namespace,
  and Temporal credential during the rollback window. The API is expected to be unavailable while
  its retained integration has no gateway task.
- Disable actions on only the two process-heartbeat alarms and treat expected heartbeat silence as
  non-breaching while idle. All database, queue, DLQ, Lambda, durable, cost, and security monitoring
  remains active.
- Create separate refresh-backed, checksum-reviewed plans for development and staging. Each idle
  plan must contain exactly four in-place updates: two service desired counts and two heartbeat
  alarm postures. It must contain no create, delete, replacement, route, trigger, task-definition,
  secret, policy, database, storage, queue, KMS, or Lambda change.
- Preserve an exact reverse-plan operator. Resuming ECS is an explicit rollback action, never an
  automatic response to the idle API being unavailable.
- New functional and conformance work targets the Lambda replacements. The retained ECS path is
  used only for an explicitly reviewed rollback before retirement.

After both environments reach the verified idle posture, continue ADR-016 from coordinated Lambda
rollback/restoration, staging cutover, development cutover, bounded rollback expiry, destructive
retirement, provider cleanup, repository cleanup, and post-cutover cost reconciliation. The idle
posture stops continuous application compute early; it does not claim Lambda cutover, replacement
acceptance, Temporal retirement, or D0-016 completion.

## Consequences

- Development and staging API requests fail while the retained API integration has no ECS target.
- Normal Temporal polling and outbox dispatch stop. The preflight must therefore fail closed on any
  pending outbox row or running workflow.
- Gateway and worker task public IP assignments are released after the tasks stop. The ECS cluster
  and retained service definitions do not themselves incur Fargate task compute charges.
- A later full Terraform plan must preserve the explicit idle input until Lambda cutover or an
  approved ECS resume. Deployment and conformance tooling must recognize both stable `1/1/0`
  continuous and stable `0/0/0` retained-idle service postures.
- Historical ECS alert, availability, and tracing drills remain evidence of the old runtime; they
  are not rerun while idle. New acceptance evidence comes from the Lambda route and durable path.

## Alternatives

- Keep ECS running until both cutovers. Rejected for the current zero-traffic environments because
  it preserves availability that no user requires while continuing fixed application compute.
- Delete ECS, VPC Link, Cloud Map, images, and Temporal access immediately. Rejected because it
  collapses idle shutdown, cutover, rollback expiry, and destructive retirement into one unsafe
  and poorly reversible change.
- Scale services directly with the AWS CLI and tolerate Terraform drift. Rejected because later
  plans could restart tasks or obscure the authoritative runtime state.

