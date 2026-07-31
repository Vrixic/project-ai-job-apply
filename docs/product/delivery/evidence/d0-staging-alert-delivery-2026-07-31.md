# D0 Staging Alert Delivery Evidence — 2026-07-31

## Scope

This record covers the controlled subscription and ALARM/recovery notification-path acceptance
for the already-provisioned encrypted staging operational-alert topic in `us-east-2`.

It proves an accountable operator can receive both states from the dedicated synthetic canary. It
does not prove service restart, application rollback, PostgreSQL restore, workload/cost
baselines, independent Auth0 isolation, production readiness, or accountable security/privacy
approval.

No email address, subscription ARN, topic ARN, AWS account identifier, raw notification, raw log
event, candidate value, identity, token, secret, or infrastructure identifier is retained.

## Reviewed operator

[PR #45](https://github.com/Vrixic/project-ai-job-apply/pull/45) merged the environment-aware,
secret-safe alert operator and staging runbook as
`ada868f0ae91f8d8236f00f4609de202594df39c`.

The operator:

- accepts only `development` or `staging`;
- derives the temporary IAM Identity Center profile and exact resource names from that allowlist;
- rejects long-lived AWS callers and a profile outside `us-east-2`;
- requires explicit `-Execute` for subscription or canary mutation;
- accepts the destination only through hidden input and never prints or writes it; and
- changes only the selected environment's dedicated `AlertDeliveryCanary` metric during the
  exercise, with a final recovery value in its cleanup path.

PowerShell parsing, help output, repository formatting, diff checks, local documentation links,
and a live read-only staging status check passed before merge.

## Subscription acceptance

The pre-subscription staging status reported:

- topic available;
- zero confirmed subscriptions;
- zero pending subscriptions;
- canary state `OK`;
- one ALARM action; and
- one OK action.

The product owner entered the destination through the hidden prompt and used the AWS-generated
confirmation link. A subsequent read-only status reported exactly one confirmed subscription,
zero pending subscriptions, canary state `OK`, and both transition actions. The destination did
not enter source, Terraform, command history, chat, or shared evidence.

## Controlled ALARM and recovery

The reviewed operator changed only the synthetic canary metric. In 118 seconds it:

1. reached `ALARM`;
2. published the recovery value;
3. reached `OK`; and
4. published a final recovery value.

CloudWatch alarm history independently contained one ALARM and one OK transition in the
observation window. The product owner confirmed receipt of both sanitized AWS notifications.

## Final technical checks

Read-only post-exercise inspection established:

- all eight staging alarms have both ALARM and OK actions;
- all eight staging alarms are `OK`;
- the canary has one confirmed and zero pending subscriptions;
- gateway and workflow worker remain `ACTIVE` at desired `1`, running `1`, pending `0`;
- 161 recent structured application-log events contain zero error-level events; and
- the same events contain zero candidate/credential-field, email, or JWT-pattern matches.

No Terraform-managed resource was changed. The subscription is intentionally managed outside
Terraform so the destination cannot enter plans or state, and the canary finished healthy.

## Result

Synthetic staging alert delivery passes. Remaining staging engineering acceptance is service
restart plus application-only rollback/reenablement, isolated restore, and representative
workload/cost evidence. The ADR-014 dedicated-identity cutover and replay remain mandatory before
launch.
