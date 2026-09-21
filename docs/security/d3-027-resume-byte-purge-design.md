# D3-027: Purging the stored bytes of deleted resumes (design for the owner to review)

- Status: **Approved by the owner 2026-09-21 (all three recommendations: erase unreviewed proposals, keep security-held bytes 30 days then purge, candidate-rights maintenance runtime). Nothing is built yet.** Prepared 2026-09-21 at the owner's request. Guard edits and saved plans in the slices below still need their own owner approvals.
- Task: D3-027 in the [Phase 3 record](../product/delivery/phase-3-application-preparation.md). Depends on D3-026 (deployed 2026-09-21).
- Decision record: [ADR-034](../adr/034-resume-byte-purge-runs-in-the-candidate-rights-maintenance-runtime.md). This finishes the second half of [ADR-033](../adr/033-resume-deletion-is-a-tombstone-with-a-separate-byte-purge.md).
- Goal: when a candidate deletes a resume, every stored copy of it and of what was extracted from it is actually removed within minutes, provably, and without giving the internet-facing Gateway permanent-delete rights. Development stays synthetic-only; this is a precondition when the ADR-023 real-resume gates are reviewed, not a change to them.

## Where things stand

| Fact | State |
|---|---|
| Delete (D3-026) | A tombstone: `documents.resume_documents.deleted_at`. Row, object keys, and bytes stay. Only `parsed`, `failed`, `rejected` rows can be deleted |
| Bucket | One versioned, KMS-encrypted bucket. Source at `quarantine/<documentId>/source`; normalized text at `normalized/<documentId>/<sha256>/<parserVersion>/resume.json`. No Object Lock and no lifecycle expiry on it |
| Who can delete object versions | Only the candidate-rights activity role (`s3:DeleteObjectVersion` on the bucket, `s3:ListBucketVersions`). It already runs exact version deletion for account deletion, and a `rate(5 minutes)` maintenance rule already invokes the same Lambda (`expireDueExports`) |
| Other places a deleted resume still lives | (1) Profile: unreviewed proposals hold extracted resume text in `profile_fact_versions.fact_value`, with evidence spans that point at the document. (2) Documents: `idempotency_keys.response` stores the upload response including the **file name**; `processing_receipts` and `processing_dispositions` hold object versions. (3) Nothing in Applications: it stores only the resume hash |
| Account deletion | Purges everything, but from the recorded exact keys only |

## What must be true when done

1. A delete followed by at most one sweep (target 15 minutes, alarm at 1 hour) leaves **no version and no delete marker** under `quarantine/<id>/` or `normalized/<id>/`, confirmed by a second listing before anything in the database is removed.
2. No file name, hash, or object reference for that resume remains in Documents; one value-free audit event (`resume.purged`) records that it happened.
3. Unreviewed Profile proposals derived only from that resume are erased; facts the candidate confirmed or edited stay.
4. Every step is idempotent and safe to repeat after a crash, a partial S3 failure, or an overlapping sweep. A failure never leaves a candidate-visible half state (the row is already hidden).
5. Nothing new can delete objects except the runtime that already can; the Gateway gains no S3 delete right.

## Design

**Where it runs.** A second step in the existing candidate-rights maintenance handler (`profile-readiness-lambda.ts`, rule `candidate-rights-maintenance`, every 5 minutes), beside `expireDueExports`. It runs in the role that already holds delete and list on the bucket, so no IAM, Lambda, schedule, or alarm resource is added. A sweep processes at most 25 tombstones (bounded like exports), reports counts only, and **throws after the batch if any tombstone failed**, so the existing `profile_readiness_activity_errors` alarm and the rule's dead-letter alarm fire while the others still complete. That Lambda has reserved concurrency 1 and a 300 second timeout, so sweeps cannot overlap and a sweep can delay an account-deletion activity by at most its own bounded run.

**Per tombstone, in this order (each step idempotent):**

1. `PostgresResumeProposalWriter.retireDocumentProposals(transaction, user, document)` (a Profile-owned method on the class the document processor already uses to import proposals; the Profile store is already bundled in both the maintenance Lambda and the Gateway, so it needs no migration): hard-deletes the profile facts whose every version is still `proposed`, whose source is this resume by source reference, and whose evidence points only at this document; cascade removes versions and evidence; also removes the document's import record and writes a count-only audit event. Facts the candidate confirmed, edited, or rejected are untouched.
2. Delete every version and delete marker under the two exact prefixes derived from the document id. Keys are **derived and validated** (`^quarantine/<uuid>/` and `^normalized/<uuid>/` with the row's own id), never taken from a stored or caller-supplied string, so the sweep cannot be pointed at any other object. Prefix listing also catches a normalized object left by an earlier parser version that the recorded key would miss.
3. List both prefixes again. Only if both are empty, call `documents.complete_resume_purge(user, document, true)` (new Documents SQL function, same attestation pattern as `delete_candidate_data`): in one transaction it verifies the row is tombstoned, deletes the matching `idempotency_keys` rows (the ones whose stored response names this document), deletes the row (cascading receipts and dispositions), and writes `resume.purged`.
4. If the row is already gone (account deletion got there first), the step is a no-op.

**Selection.** `documents.pending_resume_purges(limit)` returns identifiers only (user id, document id, whether a security hold applies), oldest tombstone first. The final function takes the per-candidate advisory lock that registration and deletion already use, so it also orders against an upload.

**Immediate proposals (slice 4).** The delete route also calls the same Profile method right away (through a port composed in the Gateway, as with `ResumeLimits`), so the review list is clean at once instead of after the next sweep. The sweep still runs it first, so a Gateway failure between the two writes is harmless.

**Security-held documents.** A row that a malware scan flagged keeps its bytes as evidence. Recommendation: the sweep skips it for 30 days after deletion, then purges it like any other, and reports a count of held tombstones so they are visible. (Owner decision 2.)

**Backup and restore.** A point-in-time restore to a moment after the tombstone re-runs the purge. Restore to before the delete resurrects a row whose bytes are gone; tailoring reads then fail closed and the candidate can delete it again. That is the safe direction (no bytes come back). Account-deletion restore replay is unchanged. Extending the recovery ledger to per-resume purges is not proposed while data is synthetic.

## Alternatives considered

| Option | Verdict |
|---|---|
| **A. Maintenance step in the candidate-rights Lambda (proposed)** | No new privilege, resource, or alarm; reuses the tested batching and the maintenance pattern. Cost: deletion code lives in the Workflows package, and no guarded release mode updates that Lambda's code alone today |
| B. Add delete to the document processor role | Broadens a role that handles scan events and invokes the parser; needs a Terraform IAM change and exact-policy guard edits. Release path exists |
| C. New dedicated purge Lambda and role (prefix-scoped) | Best isolation, largest surface: new function in every retained baseline, new artifact path, new guards. Reasonable later hardening once real resumes are in scope |
| D. Delete in the Gateway request | Rejected in ADR-033 |
| E. S3 lifecycle expiry by tag | Rejected: granular only to days, not verifiable, and the tagger could overwrite the `GuardDutyMalwareScanStatus` tag that the bucket policy trusts |

## Failure modes

| Failure | Behavior |
|---|---|
| S3 delete partially fails | Batch reports errors, sweep throws after the batch, the row stays tombstoned, next sweep retries; nothing in the database is removed |
| Second listing not empty | Same: no database change, retry |
| Database step fails after S3 is empty | Next sweep lists empty prefixes, attests, retries the function |
| Profile method fails | Objects are not touched for that tombstone; retried next sweep |
| Two sweeps overlap | Not possible on the same alias (reserved concurrency 1; a throttled invocation is retried by the rule); the operations are idempotent and the database function is serialized per candidate anyway |
| Account deletion runs at the same time | Both idempotent; whichever removes the row first wins |
| Sweep cannot run at all | Tombstones accumulate but stay hidden; Lambda error alarm; documented manual purge is the same function with the same guards |
| Persistent unknown-key or prefix mismatch | Sweep throws, alarm; nothing is deleted outside the derived prefixes |

## Tests (before any deployment)

- **Unit:** key derivation and validation (rejects other ids, other prefixes, traversal, empty), step order (Profile, S3, re-list, database), no database call when the re-list is not empty, batch continues past one failure and then throws, counts-only logging (no ids or names), handler still rejects foreign events.
- **Real PostgreSQL:** both new functions, including the attestation refusal, refusal on a non-tombstoned row, idempotency-key and cascade removal, the audit row, other candidates untouched, a concurrent upload for the same candidate, and repeat calls. Profile: confirmed and edited facts survive, proposals with mixed-document evidence survive, cascade erases versions and evidence.
- **AWS boundary:** a fake S3 client that pages, returns per-key errors, and shows late-appearing versions, to prove the second listing gates the database step.
- **Deployed synthetic acceptance (owner reviews the plan):** upload a generated resume, wait for parse, delete it, wait one sweep, then prove with read-only listings that both prefixes hold no versions or markers, that the row and idempotency entry are gone, that its unreviewed proposals are gone while a confirmed fact survives, and that `resume.purged` exists. This extends the existing document-processing acceptance harness.

## Plan (one PR open at a time; each release only after its PR is merged)

| Slice | Content | Approvals needed |
|---|---|---|
| 0 | This design accepted; ADR-034 accepted; owner decisions below | Owner |
| 1 | Documents `0005` migration (two SQL functions, the `resume.purged` audit action), the Profile `retireDocumentProposals` method; real-PostgreSQL tests; migration inventory pins 49 to 50 | Pin edits (as before) |
| 2 | Migration image, task definition plan, one execution, verify | Saved plan and execution descriptor |
| 3 | Sweep, prefix-scoped object deletion, handler wiring, unit and boundary tests; publish the workflow artifacts; **a narrow guarded release mode that updates only the profile-readiness activity and durable functions and aliases** (none exists for a code-only update today) | Guard edit approval, then saved plan |
| 4 | Immediate proposals retirement in the delete route (Gateway port), confirmation copy, web tests; Gateway release and web deploy | Saved plan |
| 5 | Deployed synthetic acceptance; records; D3-027 to Done on the owner's confirmation | Acceptance plan |

## Decisions (approved by the owner 2026-09-21)

1. **Unreviewed proposals.** Recommended: erase them when their only source resume is purged (confirmed and edited facts stay). This also avoids duplicate suggestions after deleting and re-uploading the same resume. The alternative keeps them, which contradicts "deleted". The delete confirmation then reads: "Facts you already reviewed stay in your profile. Suggestions you have not reviewed are removed."
2. **Security-held resumes.** Recommended: keep their bytes 30 days after deletion as evidence, then purge. Alternatives: purge immediately, or never.
3. **Mechanism.** Recommended: option A above. Option C is the better isolation and can follow before real resumes. Option B is not recommended.

## Risks and open items

- The account-deletion path deletes only the exact recorded keys, so a normalized object left by an earlier parser version would survive it. Recommendation: make it verify by prefix too, as its own small task (register as a risk now).
- The release path for a code-only update of the profile-readiness Lambda must be confirmed in slice 3 before it is promised; if it needs a new guarded mode, that is a guard change and needs your approval.
- The candidate export still lists a tombstoned row until it is purged (minutes), then no longer.
- Real-resume use stays blocked by ADR-023 regardless of this task.
