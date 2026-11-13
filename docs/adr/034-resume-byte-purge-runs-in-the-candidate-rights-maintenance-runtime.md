# ADR-034: Resume byte purge runs in the candidate-rights maintenance runtime

Status: Accepted (product owner approved the recommendations 2026-09-21)
Date: 2026-09-21

## Context

[ADR-033](033-resume-deletion-is-a-tombstone-with-a-separate-byte-purge.md) made candidate deletion a tombstone and left
the stored bytes for a separate purge. Real removal needs permanent-delete rights on a versioned bucket, which only the
candidate-rights activity role holds. The design and its alternatives are in the
[D3-027 design](../security/d3-027-resume-byte-purge-design.md).

## Decision

1. **Mechanism.** The purge is a second step of the existing candidate-rights maintenance handler that already runs every
   five minutes in the role that holds `s3:DeleteObjectVersion` and `s3:ListBucketVersions` on the candidate-document
   bucket. No new IAM, Lambda, schedule, or alarm resource is added, and the Gateway gains no delete right. Alternatives
   (document processor role, dedicated purge Lambda, S3 lifecycle, Gateway request) are rejected or deferred in the design.
2. **What is removed, in order.** Unreviewed Profile proposals whose only source is the resume (through a Profile-owned store
   method); every version and delete marker under `quarantine/<id>/` and `normalized/<id>/`, with keys derived from the
   document id and validated, never accepted from a caller; then, only after a second listing is empty, the Documents row,
   its idempotency entries, receipts, and dispositions, through a Documents-owned SQL function that takes the same
   attestation as account deletion. One value-free `resume.purged` audit event remains.
3. **Ownership.** Documents exposes SECURITY DEFINER functions with a pinned search path and Profile exposes a store method;
   the maintenance runtime orchestrates them. Documents does not touch Profile tables and Profile does not touch
   Documents tables.
4. **Failure behavior.** Every step is idempotent. A failed tombstone leaves the database untouched, the sweep throws after
   the batch so the existing alarms fire, and the next sweep retries. Nothing outside the derived prefixes can be deleted.
5. **Security-held resumes** keep their bytes as evidence for 30 days after deletion, then are purged. **Unreviewed
   proposals** are erased when their only source resume is purged; confirmed and edited facts stay. Both approved by the
   owner 2026-09-21.
6. **Refines ADR-033.** ADR-033 said the purge would "remove the row's object references"; the row is removed entirely once
   the bytes are verified gone, because the file name would otherwise survive in the row and in the stored idempotency
   response. ADR-033 stays otherwise accepted as written.

## Consequences

- One forward-only migration (Documents `0005`) and a further migration-inventory pin update (49 to 50). Profile needs no
  migration: its retirement is a store method, which the maintenance Lambda and the Gateway already bundle.
- The profile-readiness activity Lambda's code must be released. No guarded mode did that alone, so `-RefreshCandidateRightsActivity`
  was added (owner-approved guard change, 2026-09-21). Because the archive also serves the terminal Lambda and the module binds the
  activity version into the durable workflow, a code-only release changes 12 resources and 2 outputs; the mode allows exactly that set.
- Deletion code for documents lives in the Workflows package, following the account-deletion precedent.
- **Found live (2026-09-21):** the workload permissions boundary allowed `s3:DeleteObjectVersion` only on the candidate-exports
  bucket, so the role that already "held" delete on paper was denied on the documents bucket, for the purge and for account deletion
  of stored resumes alike. The owner approved one boundary statement scoped by `aws:PrincipalArn` to the activity role (bootstrap
  change set `candidate-documents-version-delete-v1`).
- A restore to before a deletion can bring back a row whose bytes are gone; that is the safe direction.

## Alternatives

See the design. In short: adding delete to the document processor role broadens a role that handles scan events; a
dedicated purge Lambda is the strongest isolation with the largest guard surface and remains a later hardening; S3
lifecycle expiry is not verifiable and needs a tagger that could overwrite the malware-scan tag the bucket policy trusts.

## Amendment: the purge reports what blocks it (2026-11-12)

A tombstoned resume with an unsettled native resume generation failed the sweep every time with a bare SQLSTATE 55000 and no
reason (Documents migration 0020). `complete_resume_purge` now abandons a pending generation that never launched, and for a
generation that is launch-claimed or bound returns a typed `native_generation_unsettled` result (states and booleans, no
identifier) instead of throwing; nothing is deleted. The sweep counts it as a failure, so the alarm and the "a stuck purge is an
incident" rule are unchanged, and logs `resume_purge_blocked` with the same fixed fields. Whether and how a generation whose task
no longer exists may be settled is a separate decision that needs the reported evidence first.

## Amendment: a purge settles a native generation whose task is gone (2026-11-12)

The reporting in migration 0020 showed the blocker on the restored development environment: one deleted resume with a native
resume generation still `bound` to a task whose retirement receipt was never recorded, 559 hours past its expiry. ECS keeps a
stopped task's description for about an hour, so after that window the proof [ADR-040](040-native-temporary-material-processes.md)
asks for can never be obtained, and the purge of that resume (and so the alarm, and so the rights run's health gate) was stuck
for good. This is a hole in the design, not a one-off: any retirement that is not recorded within an hour of the task stopping
leaves a deleted resume undeletable.

Migration 0021 adds `complete_resume_purge(user, document, objects_absent, absent_task_arns)`; the three-argument form calls it with
an empty list. The sweep first asks as before. For a generation that is `bound`, has a claimed launch, and whose retention ended
more than a day ago (a completed generation expires 30 minutes after completion; one that never completed counts from its
binding), Documents returns the task ARN to the sweep. The sweep asks ECS about exactly those tasks with `DescribeTasks` in the
retained native clusters and sends back only the ones ECS reports `MISSING` or `STOPPED`; a running, starting or stopping
task, any other failure, an answer that does not fit the request, an error, or a cluster that is not retained leaves the task
unproven and the purge blocked. Documents then re-checks the state, the claimed launch, the age, that the ARN is on the list and
that the resume is tombstoned and past any security hold, and only if that evidence covers every generation of the resume that
is still unsettled (otherwise it writes nothing), retires them and deletes the resume in the purge transaction. The
retirement times written to satisfy the table's checks (both now) never persist because the row is deleted in the same
transaction; the only trace is a count in the value-free `resume.purged` audit metadata and an info log with the same count.

What this is not: it is not a retirement receipt and it does not change how a generation settles while its resume lives. It
applies only to a resume the candidate deleted, only after a day, and only with ECS evidence in hand. Everything else keeps
the 0020 behaviour: a typed result, nothing deleted, the alarm. The maintenance role gains `ecs:DescribeTasks` (no StopTask,
RunTask or exec) on the tasks of the clusters the Gateway and the cleanup function already retain, a matching statement in the
private ECS endpoint policy and the cluster list in its environment. The workload boundary is a ceiling over every workload
role, and its DescribeTasks statements are bound to the Gateway and the cleanup worker, so the maintenance role was denied
until the bootstrap boundary gained its own DescribeTasks-only statement bound to that role (found on the first live sweep
after 0021: `AccessDeniedException`, and the IAM simulator named the boundary; the first version of this amendment wrongly
said no boundary change was needed). The boundary was within two characters of IAM's 6,144 limit once the restore role is
enabled, so statement ids that no test or reviewer looks up were dropped to make room (ids have no effect on evaluation).
The sweep logs `resume_purge_blocked` with counts only (bound tasks old
enough to check, whether an observer is configured, how many ECS showed gone) and never a task ARN, cluster or message.
