# D0 staging serverless cutover source evidence — 2026-08-05

## Outcome

The staging cutover is now expressed as one fail-closed Terraform control and one guarded,
staging-fixed planning path. Local infrastructure tests prove the intended API and workflow shape.
No AWS plan was generated, no resource was mutated, and no traffic or queued record moved during
this source-only step.

## Implemented boundary

- Replaced the independent dispatch and trigger inputs with `serverless_runtime_cutover`, default
  `false`. Enabling it requires the complete gateway Lambda, serverless outbox, durable workflow,
  deployed application boundary, and retained idle ECS posture.
- Added a direct HTTP API v2 Lambda proxy integration. The `$default` route acquires the exact JWT
  authorizer while only `GET /health/live` and `GET /health/ready` remain public.
- Coupled the gateway's new-event route to `lambda_durable` with the SQS starter, scheduled
  reconciler, and durable terminal-recovery rule. The prior ECS integration remains managed for the
  rollback window and ECS desired capacity remains zero.
- Extended the shared strict workflow planner with a cutover-only action allowlist and semantic
  checks. It rejects nonempty deployed outbox state, open Temporal workflows, unrelated API/ECS
  changes, deletion, replacement, and any route or trigger state outside the accepted boundary.
- Added a staging-only wrapper, Terraform composition test, source-policy assertions, and an
  operator runbook.
- Added a completed-runtime verification mode that requires a refresh-backed zero-change plan,
  exact live API route/auth/integration state, durable dispatch/triggers, empty work boundaries,
  all ten runtime alarms healthy, and retained ECS at `0/0/0` with zero running tasks.
- Added a staging-only checksum-gated apply/rollback/restoration coordinator. Apply never replans;
  rollback and restore receive separate review checksums, reject queued or running legacy and
  serverless work, preserve all rollback resources, and keep ECS capacity unchanged.
- Extended deployed web conformance with a real `lambda-cutover` mode that verifies the public
  route and trigger boundary, runs public `200/200/401`, and targets the deployed API directly.
- Corrected the legacy-drain operator to consume the deployed version-one inspector's
  `maximumAttempts` field. The earlier read-only probe failed before worker execution, context
  creation, or record mutation.
- Removed a false cutover dependency from the terminal-recovery DLQ policy. The exact terminal-rule
  ARN is now derived from stable account, region, and owned-name inputs, so enabling that rule does
  not make its unchanged least-privilege queue policy unknown at plan time. The planner retains its
  exact three-create/six-update allowlist instead of accepting an unnecessary seventh update.

## Local verification

- PowerShell parsing/help passes for the shared planner, staging wrappers/operators, deployed web
  conformance launcher, idle operator, and deployed outbox inspector.
- Terraform formatting and both persistent environment validations pass with Terraform 1.9.8.
- Platform module tests pass the dark defaults, idle ECS posture, and atomic cutover composition.
- Repository checks, serverless infrastructure policy validation, and whitespace validation pass.

## Remaining live gates

1. Merge the plan-stability correction and regenerate from exact `main`.
2. Generate and inspect the fresh staging cutover plan. Explicit product-owner authorization must
   quote its exact checksum before apply.
3. Apply only that plan through the checksum-gated operator and run authenticated persistence,
   cross-user isolation, durable completion, queue/DLQ, alarm/log privacy,
   idle-ECS/no-new-Temporal, workload, and zero-drift acceptance.
4. Execute the separately checksum-reviewed rollback and restoration drill while traffic remains
   zero, then repeat replacement acceptance and clean only the ignored local recovery artifacts.
5. Retain the old integration and ECS/Temporal resources until the rollback window expires.

SR-005 and SR-006 remain in progress. This evidence is source implementation, not deployment or
cutover acceptance.
