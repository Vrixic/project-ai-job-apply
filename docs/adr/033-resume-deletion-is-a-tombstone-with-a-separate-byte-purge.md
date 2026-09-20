# ADR-033: Resume deletion is a tombstone, with a separate byte purge

Status: Proposed (product-owner acceptance pending)
Date: 2026-09-20

## Context

With a stored-resume limit of one ([ADR-032](032-billing-owned-plan-limits-enforced-by-owning-contexts.md)) a
candidate must be able to remove a resume to upload another. The owner chose "delete, then upload a new one"
over an in-place replace. Removing the stored bytes is a different problem from removing the resume from the
candidate's account: source and normalized objects sit in a versioned, KMS-encrypted bucket, and only the
candidate-rights worker holds `s3:DeleteObjectVersion` on it. Giving the internet-facing Gateway permanent-delete
rights, or adding a purge role, is an IAM change that needs its own reviewed plan.

## Decision

1. **Deletion is a tombstone.** `deleted_at` is set on the `documents.resume_documents` row (migration
   `0004_resume_deletion`). Nothing else about the row changes: the object keys, object versions, and processing
   state stay exactly as they were, so `documents.candidate_object_inventory` still names every stored object and
   candidate data deletion still purges the bytes with its exact, version-aware, attested procedure.
2. **What deletion does at once.** The resume leaves the candidate's list, stops counting against the plan limit
   (the next registration sees the freed slot), and can no longer be selected for tailoring
   (`findParsedResume` ignores it, so an existing application's resume section shows the normal no-resume state
   until a new resume is parsed). One `resume.deleted` audit event is written with the prior status
   only; no file name, hash, or content.
3. **Only finished resumes can be deleted.** `parsed`, `failed`, and `rejected` only. A resume still uploading,
   scanning, or parsing is refused with `409 resume_not_deletable`, so a late scan or parse result can never land on
   a row the candidate already removed. The database enforces this with a check constraint.
4. **Idempotent and owner-scoped.** `DELETE /v1/resumes/{documentId}` (scope `documents:write`, UUID v7 path,
   no query, no body) returns `204` when the resume is deleted, was already deleted, does not exist, or belongs to
   someone else, so it is not an existence oracle. A per-candidate advisory lock, the same one registration takes,
   orders a deletion against an upload for the same candidate.
5. **Deletion is permanent.** A trigger refuses to clear or change `deleted_at`, so no path can un-delete a resume
   whose bytes may already have been purged.
6. **Bytes are purged separately (D3-027).** Until that lands, a deleted resume's encrypted bytes remain in the
   candidate-document bucket. The purge needs an IAM change (a reviewed Terraform plan) and a worker that removes
   every version and delete marker under the tombstone's keys, then removes the row's object references. It should be
   treated as a precondition when the ADR-023 real-resume gates are reviewed (ADR-023 itself is unchanged). Development stays synthetic-only, and
   account deletion already purges everything.
7. **Derived data.** Profile fact proposals and confirmed facts extracted from a resume belong to Profile and are
   not removed by deleting the resume; the delete confirmation says so. Whether and how deleting a resume should
   retire its unreviewed proposals is part of D3-027.

## Consequences

- No new IAM, no new worker, and no new operator mode now; one forward-only Documents migration and the pinned
  migration inventory (49 migrations) change.
- Until the purge exists, "delete" means removed from the account and unusable, not bytes erased. That is stated
  in the delivery record and must be shown to the owner before any real-resume gate is reviewed.
- The candidate data export still lists tombstoned resumes' metadata because the platform still holds them.
- Replacing in place (upload the new one first) is not supported; with a limit of one the candidate deletes first.

## Alternatives

- **Delete the bytes in the request.** Rejected for now: it needs permanent-delete rights on the Gateway role.
- **Hard-delete the row now and purge later.** Rejected: it loses the object keys the account-deletion inventory
  relies on, leaving unreachable bytes.
- **New `deleted` status.** Rejected: it would collide with the failure-code check and the legal-transition
  trigger, and would blur processing state with candidate intent.
- **Replace in place.** Rejected by the owner in favor of delete then upload.
