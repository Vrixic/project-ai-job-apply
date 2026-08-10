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

Afterward, require `CanaryState: OK`, both actions on every managed alarm, API and durable-trigger
health, an empty ECS application boundary, and zero unexpected application-error or forbidden-log
matches. Record only sanitized aggregate evidence.
