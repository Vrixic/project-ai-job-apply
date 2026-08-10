# Staging serverless cutover acceptance — 2026-08-06

## Scope and result

The isolated synthetic staging environment now routes its public API directly through the accepted
gateway Lambda and dispatches new profile-readiness work through SQS and the versioned Lambda
durable workflow. Both retained ECS application services remain idle at `0/0/0`.

The positive application path and owner boundary pass:

- A fresh authenticated preference save reached `Readiness workflow: succeeded`.
- A second authenticated account received the non-disclosing isolation result and could not read
  the first account's operation.
- The original queued operation recovered through the existing transactional outbox; no replacement
  preference write was required.

This is synthetic staging engineering evidence. It does not authorize real candidate data, public
launch, ATS submission, or substitute for accountable legal/security approval.

## Reviewed deployment evidence

- The atomic runtime cutover applied exactly three creates and six bounded updates, with no deletes,
  replacements, ECS-capacity change, or persistent-resource change.
- Subsequent accepted maintenance corrected API Gateway identity normalization, Auth0 audience
  handling, the exact protected-route scopes, and encrypted-queue producer permissions.
- The encrypted-outbox repair applied exactly two IAM-policy updates and no create, delete,
  replacement, traffic, trigger, queue, key, function, data, secret, or ECS-capacity change. Its
  reviewed checksum was
  `c029dd398aa4c6f3f79a84919f374743544a3e4931317374a1df39e6c0028e57`.
- Post-repair IAM simulation allowed the gateway and reconciler to send to the exact queue and use
  the exact customer-managed key operations required by an encrypted SQS producer. The starter
  remained consumer-only.
- The reconciler claimed and sent the retained outbox row; one durable execution was accepted and
  completed. The source queue and both DLQs returned to zero, all inspected alarms were `OK`, and
  refresh-backed verification reported zero drift.
- [PR #150](https://github.com/Vrixic/project-ai-job-apply/pull/150) contains the merged producer
  permission correction and its static regression guards.

No account IDs, resource identifiers, user identifiers, operation identifiers, endpoints, secrets,
or candidate values are retained in this record.

## Recovery safeguard discovered during acceptance

The original rollback operator accepted only the pre-maintenance cutover plan. Reusing that plan
after accepted authentication, scope, artifact, or permission maintenance could reconstruct stale
runtime inputs. Source now requires every post-cutover rollback/restoration sequence to begin from
a fresh, refresh-backed, zero-change runtime-baseline plan generated from clean, current `main`.
The operator validates the current Lambda API/JWT boundary, durable dispatch, enabled triggers,
idle ECS posture, source commit, baseline path, and checksum before it can create a rollback plan.

This safeguard is source-only until merged. It changes no AWS resource. After merge, a fresh exact
runtime baseline and separately checksum-reviewed rollback and restoration plans are still required.

## Remaining gate

SR-006 and D0-016 remain `In progress`. Acceptance is not complete until the staging runtime:

1. completes the deliberate zero-traffic rollback to the retained dark boundary;
2. passes direct-alias dark conformance while the public API is intentionally unavailable;
3. restores the exact accepted current runtime through a separately reviewed plan;
4. repeats public, authenticated save, durable-workflow, cross-user-isolation, queue/alarm/log, and
   zero-drift checks; and
5. removes only the ignored local recovery plans/context after owner confirmation.

See the [staging cutover runbook](d0-provider-runtime-repository-cleanup-2026-08-08.md)
and [living migration plan](../phase-0-serverless-runtime-migration.md).
