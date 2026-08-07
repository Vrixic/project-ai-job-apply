# Development serverless runtime cutover

Use this runbook only after synthetic staging SR-006 is accepted and development still passes its
dark gateway/workflow, alarm, rollback, zero-task ECS, and zero-drift boundaries. The transition is
atomic: API Gateway routing, new-event dispatch, the SQS starter, reconciler, and durable terminal
recovery move together.

This runbook does not authorize an AWS mutation. Planning writes an ignored Terraform plan and
prints its SHA-256. Apply only that exact plan after the product owner explicitly authorizes the
checksum.

## Preconditions

- Use clean, upstream-matched `main`, Terraform 1.9.8, `us-east-2`, and the dedicated development
  IAM Identity Center profile/account/state bucket.
- Supply the exact currently deployed gateway and three workflow artifact keys, object versions,
  source/artifact digests, and pinned regional Secrets extension layer.
- Prove the gateway and reconciler producer roles can call `kms:GenerateDataKey` on the exact
  platform key before cutover. If the guarded cutover plan exposes only those two missing policy
  updates, stop and apply them as a separate checksum-reviewed prerequisite using
  `PlanOutboxProducerKms` and the development runtime-maintenance operator. This dedicated mode
  must preserve Temporal dispatch and disabled replacement triggers; never fold the policies into
  the traffic cutover or reuse the post-cutover maintenance boundary.
- Require both retained ECS services at `0/0/0`, zero running application tasks/public task IPs,
  zero pending outbox rows, zero open Temporal or Lambda durable executions, empty source
  queue/DLQs, healthy runtime alarms, and zero drift.
- Stop if any legacy work exists. Drain only an exact reviewed synthetic batch through the bounded
  retained worker; never rewrite its dispatch target or delete product records.

## Plan and review

Inspect the development command boundaries without changing AWS:

```powershell
.\scripts\plan-development-serverless-runtime-cutover.ps1 -Help
.\scripts\operate-development-serverless-runtime-cutover.ps1 -Help
.\scripts\operate-development-gateway-runtime-release.ps1 -Help
```

Run `plan-development-serverless-runtime-cutover.ps1 -Action Plan` with the exact account, state,
artifact, extension, profile, and region inputs. The shared planner must produce exactly:

- three creates: the Lambda proxy integration and two public health routes;
- six in-place updates: the protected default route, gateway function/alias, SQS starter mapping,
  reconciler rule, and durable terminal rule; and
- zero deletes, replacements, ECS-capacity changes, persistent-data changes, secret changes, or
  legacy-integration deletion.

The default route must remain JWT-protected with the exact accepted scopes, only the two health
routes may be anonymous, gateway dispatch must change from `temporal` to `lambda_durable`, and all
three workflow triggers must enable together. Review the local plan without sharing it, then run
the operator's `Status` action and record the exact SHA-256.

## Apply and acceptance

After explicit checksum authorization, run the operator's `Apply` action with the exact account,
state bucket, plan path, checksum, and `-Execute`. It revalidates the plan, caller, encrypted state,
empty legacy/serverless work, idle ECS, immutable inputs, and current source before applying the
saved plan without replanning. Immediate verification must return zero drift, durable dispatch,
enabled triggers, and idle ECS.

Then run the development `lambda-cutover` conformance and repeat:

1. public `200/200/401` health/authentication behavior;
2. authenticated preference load/save and durable readiness success;
3. a second account's non-disclosing isolation denial;
4. idempotent replay and the fixed 500-request/25-workflow workload;
5. empty outbox/source queue/DLQs, healthy alarms, privacy-safe logs, no new Temporal work, idle
   ECS, and refresh-backed zero drift; and
6. the corrected serverless workload inspector against the exact accepted time window.

Record only aggregate evidence; never retain candidate values, tokens, identities, raw responses,
or infrastructure secrets.

## Rollback and restoration

Use the same ordered boundary already accepted in staging. Start from a fresh current-source
`-Action Verify` zero-change runtime baseline. With zero traffic/work confirmed, separately:

1. plan and checksum-authorize the route/dispatch/trigger rollback while retaining the Lambda
   integration;
2. apply and verify that transition at zero drift;
3. plan and checksum-authorize deletion of only the now-unreferenced integration;
4. apply that cleanup and run dark conformance; and
5. separately plan, authorize, and apply restoration, then repeat the full cutover acceptance.

Never combine route movement and integration deletion, resume ECS implicitly, reuse a stale plan,
or delete Lambda/ECS/Cloud Map/Temporal rollback resources during this drill. Obsolete-resource and
provider retirement remain SR-008/SR-009 after the recorded rollback window expires.
