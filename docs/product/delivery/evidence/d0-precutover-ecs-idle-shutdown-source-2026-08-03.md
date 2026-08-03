# D0 Pre-Cutover ECS Idle-Shutdown Source — 2026-08-03

- Scope: development and synthetic staging zero-traffic legacy ECS runtime
- Status: Source implemented locally; no AWS plan or mutation is claimed
- Decision: [ADR-017](../../../adr/017-zero-traffic-precutover-ecs-idle-posture.md)
- Runbook: [Phase 0 ECS idle shutdown](../../../../infrastructure/runbooks/deployments/phase0-ecs-idle-shutdown.md)

## Accepted operating condition

The product owner confirmed that neither Phase 0 environment has traffic and accepted deliberate
development/staging API and normal-workflow unavailability until Lambda cutover or an explicitly
reviewed ECS resume. This acceptance changes migration order but does not authorize deletion of the
old runtime, persistent resources, provider credentials, or rollback artifacts.

## Implemented source boundary

- The reusable platform module retains continuous ECS as its default. Development and synthetic
  staging explicitly default the new `run_continuous_ecs_runtime` input to false.
- False retains the gateway and workflow-worker ECS services/task definitions while setting both
  desired counts to zero. It does not change API Gateway routing, VPC Link, Cloud Map, images,
  Lambda aliases, workflow triggers, outbox dispatch, Temporal configuration, or persistent data.
- Only the two ECS process-heartbeat alarms disable actions and treat missing data as non-breaching
  while idle. Database, queue, DLQ, Lambda, durable, cost, and security monitoring remains active.
- The guarded operator requires a clean synchronized `main`, exact isolated SSO caller, Terraform
  1.9.8, explicit zero-traffic acknowledgement, zero undispatched PostgreSQL outbox rows, and zero
  running Temporal workflows.
- Each environment receives its own ignored refresh-backed plan and checksum. Plan inspection
  allows exactly four in-place updates—two desired counts and two heartbeat alarm postures—with
  zero create, delete, replacement, routing, trigger, task-definition, secret, policy, database,
  storage, queue, KMS, or Lambda action.
- Apply repeats the zero-work preflight and accepts only the checksum-matched saved plan.
  Verification requires retained `ACTIVE` services at `0/0/0`, zero running ECS tasks, released
  public IPs for the captured task ENIs, non-notifying expected-heartbeat silence, and targeted
  refresh-backed zero drift.
- The same operator can generate and apply a separately checksum-reviewed exact reverse plan to
  return both services and heartbeat alarms to the continuous rollback posture.
- Existing development dark planners and workflow conformance accept either uniformly stable
  `1/1/0` continuous or `0/0/0` retained-idle ECS services without treating idle as permission to
  change API routing or workflow dispatch.
- Temporal Cloud conformance now has a privacy-safe aggregate option that fails when at least one
  running workflow exists and prints no workflow, credential, account, endpoint, or namespace
  identifier.

## Required validation before publication

- PowerShell parser and help paths for the guarded operator.
- Terraform formatting, development/staging validation, and platform module tests proving both
  reusable continuous and explicit idle behavior.
- Repository infrastructure policy validation, formatting, lint, typecheck, and relevant tests.
- Markdown local-link validation and repository diff review.

## Remaining deployed gates

After merge, refresh the development and staging SSO sessions independently. For each environment:

1. generate the zero-work exact-main idle plan;
2. inspect and retain only its sanitized four-update summary and SHA-256;
3. apply that exact reviewed plan;
4. verify zero running tasks, public-IP release, heartbeat posture, retained resources, and targeted
   zero drift; and
5. record separate deployed evidence without account IDs, ARNs, ENI/public IP values, secret or
   provider identifiers, raw database/workflow data, Terraform state, or sensitive plan content.

This source record does not claim an applied environment plan, stopped task, released public IP,
Lambda cutover, replacement acceptance, Temporal retirement, destructive ECS retirement, cost
reconciliation, or D0-016 completion.

