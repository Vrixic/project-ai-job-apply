# D0 Staging Application Recovery Preflight — 2026-07-31

## Scope

This record covers the read-only live baseline, reviewed recovery operator, and refresh-backed
saved Terraform plan for a controlled staging service restart followed by application-only
disablement and exact re-enablement.

No ECS restart, Terraform apply, service interruption, application deletion, or other AWS
mutation occurred during this preflight. It does not prove restart, rollback, re-enablement,
authenticated recovery, alarm recovery, staging restore, workload/cost evidence, or Phase 0
completion.

## Live baseline

The temporary staging IAM Identity Center caller and Terraform `1.9.8` were used against the
existing isolated staging state in `us-east-2`. Sanitized inspection established:

- applications remain enabled;
- gateway and workflow worker are each `ACTIVE` at desired/running/pending `1/1/0`;
- each has one completed primary deployment;
- each uses the reviewed rolling configuration of `100%` minimum healthy and `200%` maximum;
- gateway live/readiness return `200`;
- the protected endpoint without a token returns `401`; and
- no prior recovery context or saved recovery plan existed.

No account, ARN, task, endpoint, image, provider, identity, token, secret, or raw response is
retained here.

## Recovery operator

The new
[staging recovery operator](d0-provider-runtime-repository-cleanup-2026-08-08.md) and
[runbook](d0-provider-runtime-repository-cleanup-2026-08-08.md)
separate every state-changing step:

- `Status` is read-only.
- `Restart` requires `-Execute`, restarts the worker before the gateway, retains exact task
  definitions, polls gateway liveness, requires distinct replacement tasks, and ends with
  identical-input Terraform no drift.
- `PlanDisable` captures exact live non-secret configuration only inside the ignored Terraform
  data directory and creates a refresh-backed saved plan without applying it.
- `ApplyDisable` requires `-Execute`, the operator-supplied reviewed checksum, the separately
  recorded checksum, and a fresh semantic allowlist inspection.
- `PlanEnable` works only from the verified disabled posture and creates the exact reverse plan
  from the ignored captured context.
- `ApplyEnable` repeats checksum and semantic validation, waits for both services, checks
  `200/200/401`, and requires no drift.
- `Cleanup` works only from the stable enabled/no-drift posture and removes only the three
  resolved local artifacts inside staging `.terraform/`.

The operator never reads a managed secret value. The ignored context can contain account/image
and provider configuration, so neither it nor either saved plan may be committed or shared.

The no-`-Execute` apply safeguard was exercised and rejected the request before any apply. Git
ignore resolution confirmed both created preflight artifacts are excluded.

## Saved disable plan

The refresh-backed plan has SHA-256:

`0F7A9ABB1FDACB1EAAB83A48475DE8FDAC40C842FB71D2C3618B85AADB5FB8F9`

Semantic inspection accepted exactly:

- zero creates;
- one in-place operations-dashboard update;
- 16 deletes: five API Gateway resources, two Cloud Map resources, gateway/worker task
  definitions and services, one bounded tracing policy, two heartbeat metric filters, and two
  heartbeat alarms;
- zero replacements; and
- zero other changes.

The plan contains no persistent database, KMS, S3, SQS/DLQ, ECR, Secrets Manager container,
network, migration, remote-state, capacity, NAT, Redis, ALB, Multi-AZ, or identity-provider
action.

The saved plan and reconstruction context remain local and ignored for exact post-merge apply.
They may contain sensitive state/configuration and must be deleted through the operator only after
the exact re-enablement and final acceptance pass.

## Authorization boundary and next action

Merge the operator, runbook, and this preflight record, then revalidate:

1. the live enabled status;
2. merged Terraform source is unchanged from the source that produced this plan;
3. the saved plan checksum and semantic allowlist; and
4. repository checks.

After that review, an accountable operator may explicitly authorize the controlled rolling
restart and then the exact checksum-matched disable plan. Re-enablement must immediately follow
through its own newly generated, separately reviewed checksum.

The application-disabled interval intentionally removes the API and both services and may
transition heartbeat alarms. It does not authorize any persistent-resource change.
