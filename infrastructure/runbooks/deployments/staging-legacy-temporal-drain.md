# Staging legacy Temporal drain

This procedure drains exactly the three synthetic staging records accepted before the serverless
cutover source merged. It temporarily starts one standalone task from the retained immutable
Temporal worker task definition. It does not change either ECS service's `0/0/0` posture, API
routing, Lambda triggers, event targets, Terraform state, or infrastructure resources.

The data transition is material: the three reviewed outbox rows will be acknowledged, their
idempotently named Temporal workflows will run, and their operations will reach terminal state.
Planning does not authorize execution.

## Review

Work from clean, synchronized `main` with the staging IAM Identity Center session refreshed:

```powershell
.\scripts\operate-staging-legacy-temporal-drain.ps1 -Action Plan
```

Planning performs one bounded read-only inspection task and saves an ignored local context. It must
report exactly three records, zero attempts, and one worker task on execution. The context binds:

- the caller account by hash;
- the immutable worker task definition, image digest, roles, secrets, logging, and network by
  sanitized values or hashes;
- both retained services at `0/0/0` with no reviewed standalone task;
- ECS/Cloud Map public routing and gateway dispatch still targeting Temporal;
- the SQS starter plus both EventBridge replacement rules disabled;
- all three replacement queues empty and all seven workflow alarms routed and `OK`;
- zero currently running Temporal workflows; and
- the three-row count, zero attempts, and ordered identifier digest without retaining event IDs.

Review the context locally. Do not share it. Execution authorization must quote the exact printed
`PlanSha256`.

## Execute

After explicit checksum authorization:

```powershell
.\scripts\operate-staging-legacy-temporal-drain.ps1 `
  -Action Execute `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

Execution repeats the exact source, boundary, zero-running-workflow, count, attempts, and aggregate
digest checks before starting one task. It polls through identifier-free read-only inspections,
requires zero pending rows and zero running Temporal workflows twice, stops the worker in `finally`,
requires one clean worker startup and zero error-level worker records, then proves:

- zero pending outbox records;
- zero running Temporal workflows;
- no standalone drain task remains;
- both ECS services remain `0/0/0`;
- replacement queues remain empty, triggers remain disabled, and public routing is unchanged; and
- the exact reviewed live boundary is otherwise unchanged.

On success the ignored context is removed. Record only the aggregate result and checksum; do not
retain task identifiers, event identifiers, endpoints, account identifiers, or user data.

## Interrupted execution

The operator always attempts to stop its exact task. If the command host exits before that guard can
run, use the same checksum:

```powershell
.\scripts\operate-staging-legacy-temporal-drain.ps1 `
  -Action Cleanup `
  -ExpectedPlanSha256 "REVIEWED_SHA256" `
  -Execute
```

Cleanup can stop at most the one task carrying the operator's exact `started-by` identity. It reports
only the remaining aggregate count/digest and whether Temporal is clear, removes the stale context,
and requires a fresh plan. It does not reverse records already processed; Temporal workflow IDs and
database completion are idempotent, so a fresh reviewed drain safely finishes any remainder.
