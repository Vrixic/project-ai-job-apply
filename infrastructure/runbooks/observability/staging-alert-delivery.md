# Staging Alert Delivery

Use this procedure to prove the already-provisioned encrypted alarm-delivery path in the dedicated
staging AWS account in `us-east-2`. The exercise changes only a synthetic canary metric and sends
notifications to an explicitly confirmed operator. It does not modify application, queue,
database, identity, or candidate data.

## Evidence boundary

Do not record the email address, subscription ARN, topic ARN, AWS account ID, raw notification,
raw application event, token, secret, or infrastructure identifier. Retain only aggregate
subscription counts, fixed alarm state transitions, service-health counts, and operator
confirmation that both notifications arrived.

The staging environment remains synthetic-only under
[ADR-014](../../../docs/adr/014-shared-development-auth0-for-synthetic-staging.md). Alert delivery
does not prove independent Auth0 isolation, production readiness, or accountable
security/privacy approval.

## Preconditions and status

1. Use the temporary `ai-job-apply-staging-admin` IAM Identity Center profile in `us-east-2`.
2. Require the merged environment-aware alert operator.
3. Require the Terraform-managed topic and canary alarm, with at least one ALARM action and one OK
   action.
4. Keep the gateway and workflow worker at the lean one-task stable baseline.

Read the sanitized state:

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment staging -Action Status
```

Before subscription, zero confirmed destinations is expected. Any unintended pending or duplicate
subscription must be handled through a separately reviewed operator action.

## Subscribe without retaining the destination

Run:

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment staging -Action Subscribe -Execute
```

Enter the email only into the hidden prompt. The script does not print or write it. Open the
AWS-generated SNS confirmation email and confirm the subscription, then rerun `Status`. Require:

- one or more confirmed subscriptions;
- zero unintended pending subscriptions;
- canary state `OK`; and
- one ALARM action and one OK action.

Never pass the address as a command-line argument or place it in source, Terraform, a plan,
terminal history, shared evidence, or chat.

## Exercise ALARM and recovery

Run:

```powershell
.\scripts\operate-platform-alerts.ps1 -Environment staging -Action Exercise -Execute
```

The operator:

1. requires a confirmed destination and both canary actions;
2. establishes the initial `OK` state if needed;
3. publishes `1` only to `AlertDeliveryCanary`;
4. waits for `ALARM`;
5. publishes `0` and waits for `OK`; and
6. publishes a final recovery value in a `finally` block.

Confirm receipt of both the synthetic ALARM and recovery notifications. These are notification
path tests, not service incidents.

## Final checks

After the exercise:

- rerun `Status` and require `CanaryState: OK`;
- require all staging alarms to have both ALARM and OK routing;
- require gateway and worker desired/running/pending counts to remain `1/1/0`;
- require zero recent error-level application events and forbidden-field patterns; and
- record only sanitized aggregate evidence.
