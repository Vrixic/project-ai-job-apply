# D0 staging legacy Temporal drain operator — 2026-08-05

## Outcome

A staging-only, checksum-gated operator now prepares the bounded transition of the three synthetic
legacy outbox records through the retained Temporal worker. This is source evidence only: no review
context was created, no standalone task ran, and no product record or AWS runtime changed.

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

## Remaining live gates

1. Merge the operator source.
2. Run `Plan` from exact merged `main`; review its ignored context and printed checksum.
3. Obtain explicit authorization quoting that checksum, then execute the one-task drain.
4. Record zero outbox, zero open Temporal, stopped task, clean aggregate logs, unchanged boundary,
   and cleanup evidence.
5. Generate the separately checksum-reviewed atomic staging serverless cutover plan.

SR-005 and SR-006 remain in progress. This record does not claim a drain or cutover.
