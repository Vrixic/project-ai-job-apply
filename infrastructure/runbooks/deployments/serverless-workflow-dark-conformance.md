# Serverless Workflow Dark Conformance

This drill verifies the deployed workflow replacement in one selected isolated environment without
enabling a trigger, changing public traffic, or starting a real outbox event. API Gateway remains
on Cloud Map/ECS and the gateway continues dispatching events to that environment's Temporal
namespace.

## Safety boundary

- Select exactly `development` or `staging` and use only that environment's IAM Identity Center
  profile in `us-east-2`.
- Start from exact synchronized `main` and run the completed-dark Terraform verifier from that
  commit with zero drift.
- Require five healthy immutable aliases, bounded concurrency, disabled SQS/EventBridge triggers,
  seven `OK` alarms, an empty terminal DLQ, a complete durable stack, and stable ECS rollback.
- Invoke only synthetic invalid payloads that reject before any product-data write.
- Do not invoke the reconciler; it owns bounded outbox writes and belongs to the controlled
  empty-outbox cutover gate.
- Invoke the activity, starter, and terminal handlers synchronously against exact numeric versions.
- Invoke the exact numeric durable version asynchronously. Its one-hour execution timeout exceeds
  Lambda's 15-minute synchronous-invocation limit, so a synchronous probe is invalid even when the
  payload is designed to fail immediately.
- Require the uniquely named invalid durable execution to reach `FAILED`, place exactly its compact
  synthetic payload in the durable DLQ, transition both owned alarms to `ALARM`, delete only that
  exact message, and require both alarms to recover to `OK`.

AWS documents the synchronous/asynchronous behavior and the failed-asynchronous-execution DLQ
boundary in [Invoking durable Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html)
and [Durable function best practices](https://docs.aws.amazon.com/lambda/latest/dg/durable-best-practices.html).

## Prepare

After completed-dark verification from the exact source commit, run:

```powershell
.\scripts\operate-serverless-workflow-dark-conformance.ps1 `
  -Environment staging `
  -Action Plan
```

Review the exact context checksum. Require three synchronous invocations, one durable `Event`
invocation, expected durable status `FAILED`, one expected DLQ message, one exact DLQ deletion, four
alarm transitions (`OK → ALARM → OK` for two alarms), no reconciler, no product-data write, disabled
triggers, no traffic change, and committed source. Execute therefore performs a bounded AWS
mutation even though it does not change infrastructure or product data. The ignored context
contains environment identifiers and must not be copied into source or evidence.

## Execute

After explicit authorization of that exact checksum:

```powershell
.\scripts\operate-serverless-workflow-dark-conformance.ps1 `
  -Environment staging `
  -Action Execute `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

The operator requires the activity and terminal handlers to reject invalid input, the starter to
return the exact partial-batch rejection, and the exact durable numeric version to asynchronously
reach `FAILED` with `WorkflowInputRejected`. It holds the exact synthetic failure in the DLQ long
enough to prove both `ALARM` notifications, deletes only the byte-identical reviewed payload, then
requires both `OK` recovery notifications and an empty DLQ. Expect four operational notification
emails during a successful execution. The complete infrastructure, trigger, ECS/API/Temporal, and
public-traffic boundary must otherwise remain unchanged.

After execution, inspect aggregate logs without retaining raw messages, verify alarm health, and
rerun the exact-commit completed-dark verifier. Conformance in one environment does not authorize
the other environment, cutover, rollback, or retirement.

## Abandon a reviewed context

If a reviewed plan is abandoned or execution stops partway through, run checksum-gated cleanup.
Cleanup may stop only the uniquely named reviewed execution and delete only its byte-identical DLQ
message before requiring both alarms and the complete live boundary to recover. It then removes the
matching local context:

```powershell
.\scripts\operate-serverless-workflow-dark-conformance.ps1 `
  -Environment staging `
  -Action Cleanup `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

The development and staging wrapper commands fix `-Environment` and the default IAM profile for
operator convenience. The shared operator remains the only implementation of the safety boundary.
