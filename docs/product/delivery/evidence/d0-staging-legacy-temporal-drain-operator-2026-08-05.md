# D0 staging legacy Temporal drain operator — 2026-08-05

## Outcome

The staging-only, checksum-gated operator completed the bounded transition of all three synthetic
legacy outbox records through the retained Temporal worker. The exact reviewed aggregate reached
zero pending records, Temporal reached zero running workflows, the one temporary worker stopped,
and the ignored review context was removed. Public routing, replacement triggers, ECS service
capacity, and event targets did not change.

## Safety boundary

- Plan requires clean synchronized `main`, the temporary staging caller, both retained services at
  `0/0/0`, the immutable worker definition/image, ECS/Cloud Map routing, Temporal dispatch, disabled
  Lambda replacement triggers, empty replacement queues, seven healthy alarms, no standalone drain
  task, and zero running Temporal workflows.
- The review context binds exactly three untouched rows by count, attempts, and ordered SHA-256
  without requesting or printing event identifiers.
- Execute requires the exact context checksum and source/operator hashes, repeats the entire live
  boundary and row aggregate, starts exactly one retained standalone worker, and always stops it.
- Acceptance double-checks zero pending rows and zero running Temporal workflows, requires one clean
  worker startup with no error-level record, and proves routing, triggers, queues, alarms, services,
  and the complete reviewed boundary unchanged.
- Interrupted execution can stop only the exact operator-owned task and forces a fresh review of any
  aggregate remainder. Already processed rows remain safe through deterministic Temporal workflow
  IDs and idempotent database completion.

## Local verification

- PowerShell parsing and help behavior pass.
- The serverless infrastructure policy validator enforces the operator's ownership, checksum,
  aggregate-only, one-task, stop-in-finally, no-routing/no-trigger/no-capacity/no-retarget boundary.
- Repository formatting, linting, type checking, tests, and whitespace checks pass.
- Changed Markdown links resolve locally.

## Deployed execution

- The corrected Plan ran from exact merged source and accepted exactly three records with zero
  attempts. It wrote one ignored context bound to checksum
  `04a37349479ee3907dc7c09b88413d98e457fd19d99622893b951ddc1ff2fdef`.
- The product owner explicitly authorized that checksum. Execute started exactly one standalone
  retained worker and processed exactly the reviewed aggregate.
- Final inspection reported three reviewed records, zero remaining outbox records, zero running
  Temporal workflows, one worker startup record, and zero worker error records.
- The standalone task stopped, the context was removed, and the operator proved no public-traffic,
  trigger, ECS-service-capacity, or event-target change.

## Remaining live gates

1. Merge the cutover plan-stability correction and regenerate from exact `main`.
2. Generate and review the separately checksum-bound atomic staging serverless cutover plan.
3. Apply only the explicitly authorized plan, then complete the replacement acceptance and
   rollback/restoration gates.

SR-005 and SR-006 remain in progress. This record proves the legacy drain, not the serverless
cutover.
