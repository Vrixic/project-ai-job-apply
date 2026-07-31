# D0 Staging Workload Dispatcher Correction — 2026-07-31

## Scope

This record covers the first executed staging workload attempt, its aggregate AWS corroboration,
the identified transactional-outbox starvation defect, and the locally verified worker correction.
It does not claim that the corrected worker is deployed, that the workload gate passes, or that
cost acceptance is complete.

## Observed failure

The local-only workload control passed its staging preflight and generated traffic, but stopped at
the durable-workflow gate with `A workflow did not complete successfully`. The browser result did
not expose a token, identity, preference value, operation identifier, endpoint, trace, or response
body.

The aggregate AWS measurement window remained operationally healthy:

- 1,500 API requests, 204 expected-class `4xx`, and zero `5xx`;
- 14.08 ms average and 329 ms maximum API latency;
- 41.40% maximum gateway CPU and 26.17% maximum gateway memory;
- 6.40% maximum worker CPU and 17.29% maximum worker memory;
- 5.73% maximum database CPU and six maximum connections;
- zero event-queue age, zero dead-letter messages, zero application error matches, and zero
  forbidden-log matches;
- two stable services, eight managed alarms `OK`, and zero Terraform drift.

These aggregates prove that the failure was not an API `5xx`, resource-saturation, queue/DLQ,
alarm, log-redaction, or infrastructure-drift event. The request count reflects the observed
measurement window and is not represented as one complete accepted workload run.

## Root cause

The profile transaction writes a `profile.preferences.updated.v1` input event. The worker starts a
Temporal readiness workflow and marks that input published. Completing the operation then writes a
valid `profile.readiness.calculated.v1` terminal result event.

The dispatcher selected the oldest 25 unpublished rows but handled only preference-input events.
It silently skipped terminal result events without acknowledging them. After 25 terminal rows
occupied the oldest page, later preference-input events were never selected, so their operations
remained incomplete even though the gateway, worker, Temporal connection, PostgreSQL, and AWS
telemetry remained healthy.

## Correction and local evidence

The dispatcher now validates every selected event and explicitly acknowledges the Phase 0 terminal
readiness event, which currently has no downstream subscriber. Unsupported event types remain
fail-closed and are logged with identifier/type metadata only. Adding a future subscriber requires
replacing this explicit terminal acknowledgement with its reviewed delivery route.

A regression test maintains a realistic pending queue containing 25 older terminal events followed
by one preference-input event. Two dispatcher passes must acknowledge all 25 terminal events,
select the newly unblocked input, start exactly one stable-ID Temporal workflow, and acknowledge the
input without an error log. The test fails under the prior skip behavior.

The following local checks pass:

- workflow tests: 2 files and 3 tests;
- workflow TypeScript type checking;
- workflow production build; and
- Git whitespace validation.

## Remaining acceptance

Publish the correction from reviewed merged source, build and scan a new immutable worker image,
roll out only the staging worker task definition, and verify service stability plus no Terraform
drift. Then rerun the fixed browser workload and AWS aggregate measurement. Only the corrected
25-workflow result and its corroborating operational evidence can complete the workload baseline.
