# Staging legacy Temporal drain

This procedure drains an explicitly reviewed nonempty synthetic staging legacy batch through one
standalone task from the retained immutable Temporal worker task definition. The bounded operator
accepts at most 100 untouched rows and binds the exact observed count, zero-attempt state, and
ordered identifier digest into the reviewed context. It supports both the original pre-cutover
boundary and a post-cutover recovery boundary. It does not change either ECS service's `0/0/0`
posture, API routing, Lambda triggers, event targets, Terraform state, or infrastructure resources.

The data transition is material: the exact reviewed outbox rows will be acknowledged, their
idempotently named Temporal workflows will run, and their operations will reach terminal state.
Planning does not authorize execution.

## Review

Work from clean, synchronized `main` with the staging IAM Identity Center session refreshed:

For a pre-cutover recovery, run:

```powershell
.\scripts\operate-staging-legacy-temporal-drain.ps1 -Action Plan
```

For a post-cutover recovery with confirmed zero user traffic, run:

```powershell
.\scripts\operate-staging-legacy-temporal-drain.ps1 `
  -Action Plan `
  -RuntimeBoundary PostCutover `
  -ConfirmZeroTraffic
```

Planning performs one bounded read-only inspection task and saves an ignored local context. It must
report between one and 100 records, zero attempts, and one worker task on execution. The context
binds:

- the caller account by hash;
- the immutable worker task definition, image digest, roles, secrets, logging, and network by
  sanitized values or hashes;
- both retained services at `0/0/0` with no reviewed standalone task;
- the selected runtime boundary: either ECS/Cloud Map routing with Temporal dispatch and disabled
  replacement triggers, or Lambda durable dispatch with the exact Lambda/JWT route and enabled
  replacement triggers;
- one scoped JWT default route requiring `profile:read` and `profile:write`, two anonymous Lambda
  health routes, and the accepted OIDC authorizer when post-cutover;
- all three replacement queues empty and all seven workflow alarms routed and `OK`;
- zero currently running Temporal workflows; and
- the exact row count, zero attempts, and ordered identifier digest without retaining event IDs.

Review the context locally. Do not share it. Execution authorization must quote the exact printed
`PlanSha256`.

## Execute

After explicit checksum authorization:

Use the same runtime boundary that created the reviewed context. For post-cutover recovery:

```powershell
.\scripts\operate-staging-legacy-temporal-drain.ps1 `
  -Action Execute `
  -RuntimeBoundary PostCutover `
  -ConfirmZeroTraffic `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

Omit `-RuntimeBoundary PostCutover -ConfirmZeroTraffic` only for a pre-cutover context.

Execution repeats the exact source, boundary, zero-running-workflow, count, attempts, and aggregate
digest checks before starting one task. It polls through identifier-free read-only inspections,
requires zero pending rows and zero running Temporal workflows twice, stops the worker in `finally`,
requires one clean worker startup and zero error-level worker records, then proves:

- zero pending outbox records;
- zero running Temporal workflows;
- no standalone drain task remains;
- both ECS services remain `0/0/0`;
- replacement queues remain empty and the selected trigger/routing boundary is unchanged; and
- the exact reviewed live boundary is otherwise unchanged.

On success the ignored context is removed. Record only the aggregate result and checksum; do not
retain task identifiers, event identifiers, endpoints, account identifiers, or user data.

## Interrupted execution

The operator always attempts to stop its exact task. If the command host exits before that guard can
run, use the same checksum:

```powershell
.\scripts\operate-staging-legacy-temporal-drain.ps1 `
  -Action Cleanup `
  -RuntimeBoundary PostCutover `
  -ConfirmZeroTraffic `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

Use the pre-cutover defaults instead when cleaning up a pre-cutover context.

Cleanup can stop at most the one task carrying the operator's exact `started-by` identity. It reports
only the remaining aggregate count/digest and whether Temporal is clear, removes the stale context,
and requires a fresh plan. It does not reverse records already processed; Temporal workflow IDs and
database completion are idempotent, so a fresh reviewed drain safely finishes any remainder.

## Post-cutover safety boundary

`-ConfirmZeroTraffic` is an explicit operator assertion, not a traffic-control mechanism. During a
post-cutover drain, keep staging unavailable to interactive testers. The public API remains on the
accepted Lambda alias, its default route remains JWT protected with both required scopes, health
routes remain public, and the SQS/EventBridge durable triggers remain enabled. The standalone
Temporal worker can claim only legacy records whose stored dispatch target is `temporal`; it cannot
rewrite records to Lambda durable or disable the serverless path. Any aggregate growth, queue work,
open workflow, alarm change, routing change, trigger change, or additional ECS task fails closed.
