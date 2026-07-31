# Development Alert Delivery

Use this procedure to deploy and prove the Phase 0 CloudWatch alarm-delivery path in the dedicated
AWS development account in `us-east-2`. It creates no application replicas or user-data flow.

## Scope and evidence boundary

This procedure covers:

- the existing RDS CPU/storage and SQS age/DLQ alarms;
- correction of the RDS alarm dimension from the immutable RDS resource ID to the CloudWatch
  `DBInstanceIdentifier`;
- an encrypted SNS operational-alert topic with a CloudWatch-only publish policy;
- ALARM and OK actions on every managed alarm;
- a log-derived aggregate error metric and alarm;
- a dedicated synthetic notification-path canary; and
- a synthetic-safe operational dashboard.

It does not prove OpenTelemetry traces, provider/log-stream outage behavior, runtime-secret
rotation, bad-image rollback, database restore, staging, production readiness, or accountable
security/privacy approval.

Do not record the alert destination, subscription ARN, topic ARN, AWS account ID, raw notification,
raw log event, candidate value, token, or infrastructure identifier in shared evidence.

## Preconditions

1. Use Terraform `1.9.8`.
2. Authenticate through the temporary `ai-job-apply-development-admin` IAM Identity Center
   profile and confirm `us-east-2`.
3. Require merged source, a clean checkout, and the same process-scoped development variables used
   for the live application.
4. Require the gateway and workflow worker to remain at one desired, one running, and zero pending
   tasks.
5. Run the full Phase 0 repository verification and Terraform formatting/validation.

## Review the infrastructure plan

Initialize the encrypted development backend and save a refresh-backed plan. Inspect the plan JSON
without printing sensitive values.

Before publication, run the preview-only scope validator:

```powershell
.\scripts\preview-development-alert-plan.ps1
```

It reconstructs the current live application inputs without reading provider keys, permits only
the changes below, and always removes the sensitive preview artifact. It never applies.

The plan may:

- update the KMS policy narrowly for encrypted CloudWatch alarm notifications;
- create one KMS-encrypted SNS topic and its least-privilege policy;
- create one log metric filter, an application-error alarm, an alert-delivery canary alarm, and one
  dashboard;
- update the four existing alarms with ALARM/OK actions and runbook references; and
- correct both RDS alarm dimensions in place.

Reject any replacement or deletion, application task-definition or service change, image/provider
change, extra replica, network/data mutation, Redis, NAT, ALB, Multi-AZ, or unreviewed resource.
Record the saved-plan SHA-256 and apply only that exact reviewed artifact.

After apply, require a refresh-backed plan with the same inputs to report no drift. Delete the
local saved plan only after recording its hash and sanitized result.

## Subscribe without retaining the destination

Read the pre-subscription state:

```powershell
.\scripts\operate-platform-alerts.ps1 -Action Status
```

Request an email subscription:

```powershell
.\scripts\operate-platform-alerts.ps1 -Action Subscribe -Execute
```

The script prompts with hidden input and never prints or writes the email address. The operator
must use the AWS-generated confirmation link. Then run `Status` again and require:

- exactly one or more confirmed subscriptions;
- zero unintended pending subscriptions; and
- at least one ALARM action and one OK action on the canary.

Remove duplicate or abandoned pending subscriptions through a separately reviewed operator action.
Never place an alert destination in source, Terraform variables, a plan artifact, shared evidence,
or shell history.

## Exercise ALARM and recovery

Run:

```powershell
.\scripts\operate-platform-alerts.ps1 -Action Exercise -Execute
```

The script changes only `AlertDeliveryCanary` in the dedicated
`ai-job-apply/development/operational` namespace. It:

1. requires a confirmed subscription and both notification actions;
2. establishes an initial `OK` state;
3. publishes `1` and waits for `ALARM`;
4. publishes `0` and waits for `OK`; and
5. publishes a final recovery value in a `finally` block.

The operator must confirm receipt of one synthetic ALARM notification and one OK notification.
These messages are notification-path tests, not service incidents. Do not trigger the database,
queue, or application-error alarms to test routing.

## Live acceptance

Record only sanitized results and UTC timestamps:

- topic available;
- confirmed/pending subscription counts;
- six managed alarms with non-empty ALARM and OK actions;
- canary `ALARM` followed by `OK`;
- operator confirmation that both notifications arrived;
- both corrected RDS alarms receiving current datapoints and leaving `INSUFFICIENT_DATA`;
- dashboard available with RDS, SQS, ECS, application-error, canary, API, and safe warning/error
  views as applicable;
- application log group still KMS encrypted with 30-day retention;
- gateway and worker still stable at one desired/one running/zero pending; and
- zero unexpected error-level events created by the exercise.

This closes alert delivery only. Deployed OpenTelemetry trace evidence remains the next
observability substep.

## Recovery

If the canary cannot return to `OK`, publish a zero value again and stop acceptance. If
notifications do not arrive:

1. verify the subscription is confirmed without printing its destination;
2. verify the alarm has both SNS actions;
3. inspect only sanitized alarm history and SNS delivery metrics;
4. verify the SNS and KMS policies still restrict the exact account/alarm prefix; and
5. correct the reviewed source and apply a new saved plan.

Do not disable unrelated alarms, loosen the topic/KMS policy globally, recreate the database or
queues, or destroy the persistent platform while troubleshooting notification delivery.
