# Development Serverless Workflow Dark Conformance

This drill verifies the deployed development workflow replacement without enabling a trigger,
changing public traffic, or starting a real outbox event. API Gateway remains on Cloud Map/ECS and
the gateway continues dispatching development events to Temporal.

## Safety boundary

- Use only the development IAM Identity Center profile in `us-east-2`.
- Start from exact synchronized `main` and run the completed-dark Terraform verifier from that
  commit with zero drift.
- Require five healthy immutable aliases, bounded concurrency, disabled SQS/EventBridge triggers,
  seven `OK` alarms, an empty terminal DLQ, a complete durable stack, and stable ECS rollback.
- Invoke only synthetic invalid payloads that reject before any product-data write.
- Do not invoke the reconciler; it owns bounded outbox writes and belongs to the controlled
  empty-outbox cutover gate.
- Invoke the durable function synchronously. Failed asynchronous durable invocations can enter the
  configured DLQ; synchronous rejection tests the exact handler/version without contaminating it.

AWS documents the synchronous/asynchronous behavior and the failed-asynchronous-execution DLQ
boundary in [Invoking durable Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html)
and [Durable function best practices](https://docs.aws.amazon.com/lambda/latest/dg/durable-best-practices.html).

## Prepare

After completed-dark verification, run:

```powershell
.\scripts\operate-development-serverless-workflow-dark-conformance.ps1 -Action Plan
```

Review the exact context checksum. Require four planned synchronous invocations, no reconciler,
no product-data write, disabled triggers, no traffic change, and committed source. The ignored
context contains environment identifiers and must not be copied into source or evidence.

## Execute

After explicit authorization of that exact checksum:

```powershell
.\scripts\operate-development-serverless-workflow-dark-conformance.ps1 `
  -Action Execute `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

The operator requires the activity and terminal handlers to reject invalid input, the starter to
return the exact partial-batch rejection, and the exact durable numeric version to synchronously
reach `FAILED` with `WorkflowInputRejected`. It then requires the terminal DLQ to remain empty and
the entire dark boundary to remain unchanged.

After execution, inspect aggregate logs without retaining raw messages, verify alarm health, and
rerun the exact-commit completed-dark verifier. This does not authorize staging, cutover, rollback,
or retirement.

## Abandon a reviewed context

If execution is intentionally abandoned, remove only the checksum-matched context after live
boundary revalidation:

```powershell
.\scripts\operate-development-serverless-workflow-dark-conformance.ps1 `
  -Action Cleanup `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```
