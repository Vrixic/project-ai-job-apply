# D0 Staging Workload and Cost Preflight — 2026-07-31

## Scope

This record covers the reviewed fixed workload runner, read-only AWS measurement/cost operators,
runbook, tests, and live no-mutation staging baseline. It does not claim that workload traffic ran,
that billing data has posted, that budget/export controls exist, or that D0-008/D0-006/D0-011 or
Phase 0 is complete.

No workload request, database write, workflow, Terraform apply, billing export, budget, or AWS
resource was created or changed during this preflight.

## Fixed workload boundary

The local-only workload control is available only when all of these are true:

- Next.js runs in development mode;
- the launcher explicitly sets `ENABLE_STAGING_WORKLOAD_CONFORMANCE=1`;
- the launcher validated the staging SSO account, Terraform `1.9.8`, exact deployed/local Auth0
  issuer and audience, one stable gateway, and `200/200/401` gateway health/access;
- the request has the exact localhost origin and fixed confirmation phrase; and
- Auth0 provides a current server-held session and access token.

The browser cannot set request counts, concurrency, gateway origin, access token, workload payload,
or operation identifiers. The server reads the synthetic account's current saved preference
content and reuses it unchanged across 25 sequential durable workflows. It also runs 200 liveness,
200 readiness, and 100 expected protected-`401` probes at concurrency five, plus one exact
idempotent replay.

The result is limited to the profile name, timestamps, total duration, counts, pass booleans, and
p50/p95/max latency. Token, identity, preference values, response bodies, operation identifiers,
endpoints, traces, and provider/resource identifiers never enter the response.

Focused web tests pass four fail-closed/positive cases and prove the fixed profile emits 500 public
requests, 25 distinct workflow writes, one matching replay, 25 successful operation reads, and no
token/preference/operation value in the serialized result. Web type checking and all three PowerShell
parsers/help paths pass. A short no-workload window also proved the AWS measurement queries and
returned expected insufficient-count booleans rather than a false workload pass; its live service,
alarm, log-pattern, queue, and no-drift checks stayed healthy.

## Live read-only staging baseline

The temporary staging caller and deployed environment currently report:

- one available private encrypted deletion-protected source with current seven-day PITR;
- two stable services and all eight managed alarms `OK`;
- zero disposable restore targets and no restore context;
- Cost Explorer available but the current partial month still estimated at `$0.00` with zero
  nonzero services; and
- zero visible AWS Budgets and zero legacy CUR definitions.

The `$0.00` result is provider-lagged preflight state, not evidence that the deployed environments
are free. The development SSO session expired before the two-account cost inspection, so refreshed
development access and actual development billing attribution remain open.

## Measurement and acceptance boundary

After merge, the product owner runs the fixed workload from the authenticated local staging web
client. The read-only measurement operator accepts only its ISO timestamps and returns aggregate
API count/errors/latency, ECS CPU/memory, RDS CPU/connections, queue age/DLQ depth, log error and
forbidden-pattern counts, service/alarm state, and exact-input Terraform drift.

Acceptance requires 500/500 public probes, 25/25 workflows, matching idempotent replay, at least
552 corroborating API requests, at least 100 expected `4xx`, zero `5xx`, zero DLQ messages, zero
error/forbidden log matches, two stable services, eight `OK` alarms, and zero drift. Latency and
utilization are recorded as the first observed baseline rather than judged against invented
capacity thresholds.

Initial cost acceptance remains separate until both SSO sessions pass, nonzero provider billing is
available and reconciled by service, and reviewed budget plus billing-export controls exist.

## Next authorization

Merge this package and let repository checks pass. Then refresh both SSO sessions, repeat the
read-only status/cost checks, start the web client with `-EnableWorkloadConformance`, and explicitly
confirm the fixed browser workload. No infrastructure apply is authorized by this preflight.
