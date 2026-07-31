# D0 Staging Application Rollout Evidence — 2026-07-30

## Scope

This record covers applying the exact reviewed Terraform plan for the lean gateway and workflow
worker in synthetic-only staging, followed by infrastructure, health, unauthenticated,
observability, redaction, and no-drift checks.

It does not prove an authenticated Auth0 transaction, deployed cross-user denial, durable
workflow completion, alert-notification delivery, restart, application rollback, staging restore,
workload/cost baselines, independent Auth0 tenant isolation, or Phase 0 completion.

## Authorization and exact apply

- [PR #41](https://github.com/Vrixic/project-ai-job-apply/pull/41) merged the reviewed
  [staging rollout runbook](../../../../infrastructure/runbooks/deployments/staging-application-rollout.md)
  and [preflight evidence](d0-staging-application-enablement-preflight-2026-07-30.md) as
  `9a238b03fe7368a2cfb341894859e49f9b99fce5`.
- All PR checks passed: repository quality, dependency audit, integration, Semgrep, and gateway,
  worker, and web container builds.
- Terraform source was unchanged from the merged revision that produced the saved plan.
- Terraform `1.9.8` ran through the temporary staging IAM Identity Center profile against the
  existing KMS-encrypted remote state.
- The staging/development AWS account inequality, applications-disabled state, plan action
  allowlist, and exact plan checksum were reverified immediately before apply.
- Authorized saved-plan SHA-256:
  `83FA307C694D75F3E1AD9F73D36B56658F7E3660FE6C6ACCBB539151FD9EE142`.
- Apply result: 16 added, one changed, zero destroyed.

The only changed existing resource was the operations dashboard. The creates were the five API
Gateway resources, two Cloud Map resources, gateway and worker task definitions/services, the
bounded tracing policy, and four heartbeat monitoring resources recorded in the preflight. No
database, KMS, state, network, secret container/value, queue, registry, migration, NAT, Redis,
ALB, Multi-AZ, or capacity resource changed.

## Live runtime acceptance

Read-only inspection established:

- exactly two ECS services exist;
- gateway and workflow worker are `ACTIVE`, each with desired `1`, running `1`, pending `0`, and a
  completed primary deployment;
- exactly two tasks are running;
- gateway, worker, and both nonessential collectors use the approved immutable digests;
- the live task definitions contain the exact reviewed audience/issuer and the isolated staging
  Temporal endpoint/namespace configuration;
- Cloud Map contains one healthy gateway `SRV` registration with IPv4 and port attributes;
- the regional gateway returns `200` for `/health/live`;
- the regional gateway returns `200` for `/health/ready`, proving PostgreSQL readiness; and
- `/v1/me` without a bearer token returns `401`.

No gateway URL, account number, ARN, task/network/service-discovery identifier, IP address,
repository URL, provider suffix, raw response, token, or secret is retained in this evidence.

## Observability and log safety

At the acceptance observation:

- all eight staging metric alarms were `OK`;
- gateway and worker heartbeat metrics each had multiple recent datapoints;
- the operations dashboard contained seven widgets, including API Gateway and both heartbeat
  signals;
- the application role contained exactly `xray:PutTelemetryRecords` and
  `xray:PutTraceSegments`;
- X-Ray contained 12 recent trace summaries after health/acceptance requests;
- logs contained one gateway-start and one worker-start event;
- logs contained 13 gateway and 15 worker privacy-safe heartbeat events;
- structured application error events: zero;
- failure-like log events: zero; and
- database URL, managed-secret name, authorization/bearer, JWT, and email pattern classes: zero.

Collector startup emitted its version, the expected missing optional-extra-config notice, and an
unrelated exporter deprecation notice. It emitted no export, permission, connection, or other
failure event.

The staging operational topic currently has zero confirmed human subscriptions. Alarm resources
and routing exist, but ALARM/OK delivery cannot be claimed until an accountable recipient
confirms a subscription and receives both controlled transitions.

## Drift and cleanup

A refresh-backed Terraform plan with the exact applied image, Auth0, Temporal, and lean-capacity
inputs reported no changes.

The local saved plan and local Terraform output logs may contain state/environment identifiers.
They remain ignored and untracked locally because the execution safety layer rejected the exact
non-recursive cleanup command. They must be removed by the operator after this evidence is
published. No plan or raw output entered source control or shared evidence.

## Remaining synthetic staging acceptance

- Run `.\scripts\start-deployed-web-conformance.ps1 -Environment staging` and use its local web
  session to complete a controlled synthetic authenticated preference/workflow transaction. The
  launcher fails closed unless encrypted staging state resolves, ECS is stable, the live
  issuer/audience exactly match the ignored local Auth0 settings, and gateway live, readiness,
  and unauthenticated-protection checks return `200`, `200`, and `401`.
- Prove the second synthetic Auth0 account cannot read the first account's operation.
- Correlate the successful transaction with durable PostgreSQL/outbox/Temporal completion and a
  sanitized cross-service trace.
- Confirm an alert recipient and prove controlled ALARM then OK delivery.
- Exercise service restart and an application-only rollback/reenablement path.
- Complete staging restore, representative workload, and cost-attribution evidence.

Until those checks pass, this is a healthy deployed infrastructure baseline, not complete staging
acceptance. Under [ADR-014](../../../adr/014-shared-development-auth0-for-synthetic-staging.md),
all use remains synthetic-only and no identity-provider isolation or launch readiness is claimed.
