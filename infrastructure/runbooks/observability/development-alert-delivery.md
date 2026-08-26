# Development Alert Delivery

Use this procedure to prove the Terraform-managed encrypted alarm-delivery path in the dedicated
development AWS account in `us-east-2`. The exercise changes only a synthetic canary metric and
sends notifications to an explicitly confirmed operator. It does not modify application, queue,
database, identity, or candidate data.

## Evidence boundary

Do not record the email address, subscription ARN, topic ARN, AWS account ID, raw notification,
raw application event, token, secret, or infrastructure identifier. Retain only aggregate
subscription counts, fixed alarm transitions, runtime-health state, and operator confirmation that
both notifications arrived.

## Preconditions and status

1. Use the temporary `ai-job-apply-development-admin` IAM Identity Center profile in `us-east-2`.
2. Require the Terraform-managed topic and canary alarm with both ALARM and OK actions.
3. Require the API to return `200/200/401`, durable triggers enabled, ten runtime alarms healthy,
   and zero ECS application services or running tasks.

Read the sanitized state:

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment development -Action Status
```

Any unintended pending or duplicate subscription requires a separately reviewed cleanup action.

For the D1 representative-acceptance contract, retain the single compact JSON object from:

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment development -Action Status -AggregateJson
```

This mode fails closed unless the canary and every Terraform-managed runtime alarm under the exact
development name prefix are `OK` and have both ALARM and OK actions. Its
`d1_deployed_alert_status_v1` result contains only the check time, recipient counts, canary state,
action counts, and healthy runtime-alarm count. It never contains an endpoint, subscription ARN,
topic ARN, account identifier, or notification body.

## Subscribe without retaining the destination

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment development -Action Subscribe -Execute
```

Enter the address only into the hidden prompt, confirm the AWS-generated SNS email, and rerun
`Status`. Require at least one confirmed subscription, zero unintended pending subscriptions,
canary state `OK`, and both notification actions. Never pass or retain the destination in source,
Terraform, a plan, terminal history, shared evidence, or chat.

## Exercise ALARM and recovery

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment development -Action Exercise -Execute
```

The operator establishes `OK`, publishes `1` only to the dedicated `AlertDeliveryCanary`, waits for
`ALARM`, publishes `0`, waits for `OK`, and publishes a final recovery value in `finally`. Confirm
receipt of both synthetic notifications. These messages test routing; they are not service
incidents.

To produce the strict D1 aggregate, first have the accountable reviewer bind the exact confirmed
recipient set. Canonicalize only in separately controlled memory as UTF-8 without a BOM: the
literal line `d1-alert-recipient-set-v1`, followed by each confirmed email endpoint trimmed,
lowercased, ordinally sorted, and written on its own line, including one final newline. Review and
retain only the lowercase SHA-256; do not retain or paste the canonical payload. Then run:

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment development -Action Exercise -Execute `
  -AggregateJson -ReviewedRecipientSetSha256 '<reviewed-recipient-set-sha256>'
```

The operator recomputes the digest from the confirmed SNS email subscriptions before publishing a
metric and refuses a mismatch, duplicate destination, or non-email protocol. After the canary has
completed one ALARM transition and one recovery transition and is independently read back as
`OK`, the accountable operator must directly verify both sanitized notifications and type the
exact prompted confirmation phrase. The script does not infer delivery from subscription state,
CloudWatch state, or a successful publish. Retain only the resulting
`d1_deployed_alert_delivery_v1` JSON object; `deliveryConfirmed` remains `false` unless the exact
manual confirmation is entered.

Afterward, require `CanaryState: OK`, both actions on every managed alarm, API and durable-trigger
health, an empty ECS application boundary, and zero unexpected application-error or forbidden-log
matches. Record only sanitized aggregate evidence.
