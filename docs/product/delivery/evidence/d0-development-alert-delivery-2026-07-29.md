# D0 Development Alert Delivery Evidence — 2026-07-29

## Scope

This record covers the encrypted alarm-routing, operations-dashboard, aggregate application-error
monitoring, and synthetic notification-path acceptance completed in the dedicated AWS development
environment in `us-east-2`.

It does not prove deployed OpenTelemetry traces, provider/log-stream outage recovery,
runtime-secret rotation, bad-image rollback, PostgreSQL restore, staging rehearsal, production
readiness, or accountable security/privacy approval.

No alert destination, subscription ARN, topic ARN, AWS account identifier, raw notification, raw
log event, candidate value, identity, token, secret, or infrastructure identifier is retained in
this record.

## Reviewed deployment

[PR #19](https://github.com/Vrixic/project-ai-job-apply/pull/19) merged after repository quality,
dependency audit, integration, container, Semgrep, and Terraform checks passed. The post-merge
refresh-backed saved plan had SHA-256
`A6C2624862895676830A3257826B7289F3791B8DD5560E5ABA49B1CEB16E9616` and contained:

- six creates;
- five in-place updates;
- zero deletes; and
- zero replacements.

The deployment wrapper timed out while Terraform continued running. Read-only reconciliation
showed that the topic, dashboard, metric filter, two new alarms, four existing-alarm updates, and
KMS update were live; Terraform state contained the five successfully created resources. The SNS
topic policy remained absent from state and retained the AWS default policy.

An exact one-resource recovery plan with SHA-256
`2FE1F56B80041A69B5A98184F981F20BA31708BE7F21F473EB3BDB11D8C9113E` failed safely because AWS
does not permit the broad `SNS:*` action in this topic-policy context. The failed attempt wrote no
managed policy. No resource was imported, destroyed, replaced, or manually loosened.

[PR #20](https://github.com/Vrixic/project-ai-job-apply/pull/20) replaced that wildcard with the
eight explicit AWS-supported topic actions and passed the same remote checks. The post-merge final
saved plan had SHA-256
`DABC7502B82CC8C8776BA237DB05270C5B75EA5814CB63289BC1F727249902DB` and contained exactly one
policy create with zero updates, deletes, or replacements. Applying that exact artifact reported
one addition and no change or destruction. A subsequent refresh-backed plan reported no drift.

## Live infrastructure acceptance

Sanitized post-apply inspection confirmed:

- all six new resources are present in versioned Terraform state;
- the operational topic uses KMS encryption;
- the topic policy has one eight-action account-administration statement and one restricted
  CloudWatch publisher statement;
- all six managed alarms have both ALARM and OK actions;
- both RDS alarms use the correct `DBInstanceIdentifier` dimension and receive current datapoints;
- the operations dashboard and application-error metric filter are available;
- the application log group remains KMS encrypted with 30-day retention; and
- the gateway and workflow worker each remain at one desired, one running, and zero pending tasks.

## Notification-path acceptance

The secret-safe operator flow reported one confirmed subscription and zero pending subscriptions.
The alert destination was entered through hidden input and was not printed, stored in Terraform,
or added to source or evidence.

The dedicated canary changed only the synthetic `AlertDeliveryCanary` metric:

- `ALARM` at `2026-07-30T02:51:27.227Z`;
- recovery to `OK` at `2026-07-30T02:52:27.228Z`; and
- current state `OK` at the final technical check.

At `2026-07-30T02:53:28.575Z`, sanitized corroboration found one ALARM transition, one OK
transition, six alarms with both actions, zero recent error-level application events, and both ECS
services stable. The product owner confirmed receipt of both the AWS ALARM and recovery
notifications.

This closes the Phase 0 alert-delivery substep. Follow the
[development alert-delivery runbook](../../../../infrastructure/runbooks/observability/development-alert-delivery.md)
for future exercises. Deployed OpenTelemetry trace evidence is the next observability substep.
