# D0 Development Alerting Preflight Evidence — 2026-07-29

## Scope

This record covers repository implementation and a refresh-backed preview of the Phase 0
development alert-delivery path in `us-east-2`. It does not claim that the changes are merged,
applied, subscribed, exercised, or operational in AWS.

It also does not prove OpenTelemetry traces, provider/log-stream outage behavior, runtime-secret
rotation, bad-image rollback, PostgreSQL restore, staging rehearsal, production readiness, or
accountable security/privacy approval.

## Read-only live audit

Sanitized inspection found the deployed gateway and worker stable, the application log group
encrypted with 30-day retention, and four existing alarms without notification actions. The two
RDS alarms had received no datapoints because their `DBInstanceIdentifier` dimension used the
immutable RDS resource ID rather than the CloudWatch database identifier. No operational SNS
topic, subscription, dashboard, application-error metric filter, or recent deployed trace was
present.

No account identifier, ARN, log event, candidate value, identity, endpoint, token, secret, or raw
artifact is retained in this record.

## Repository implementation

The reviewed source adds:

- one KMS-encrypted operational SNS topic and a CloudWatch-only publish policy;
- narrow CloudWatch alarm use of the existing environment KMS key;
- ALARM and OK actions plus a runbook reference on every managed alarm;
- corrected RDS alarm dimensions;
- one aggregate error-level log metric and alarm;
- one isolated synthetic alert-delivery canary;
- one synthetic-safe operations dashboard;
- a secret-safe subscription/status/canary operator script; and
- a preview-only Terraform scope validator that always removes its sensitive saved plan.

The Phase 0 verification script now also fails immediately when a native `pnpm` or Docker command
returns a non-zero exit code.

## Refresh-backed preview

The preview-only validator reconstructed the exact live application inputs through read-only AWS
and Terraform output calls, created a temporary refresh-backed plan, allowlisted every action, and
removed the plan after inspection.

Sanitized result:

- plan SHA-256: `A9EECA0EF6263E76E69FFC0AB745AB2E11B47A9259B9A1B90870647BFDE64A78`;
- six creates;
- five in-place updates;
- zero deletes; and
- zero replacements.

The six creates are the dashboard, application-error metric filter and alarm, alert-delivery
canary alarm, encrypted SNS topic, and SNS topic policy. The five updates are the existing four
alarms and the environment KMS policy. No application task, service, image, database, queue,
network, replica, NAT, ALB, Redis, Multi-AZ, or provider configuration changes.

This preview artifact is intentionally not an apply artifact and was deleted. After merge, a new
exact saved plan must be reviewed and hashed before any AWS apply.

## Remaining acceptance

Follow the
[development alert-delivery runbook](../../../../infrastructure/runbooks/observability/development-alert-delivery.md)
after the implementation is merged. Apply only the exact reviewed saved plan, prove no drift,
establish a confirmed destination without retaining it, exercise the isolated canary through
`ALARM` and `OK`, confirm both notifications, and record sanitized deployed evidence.
