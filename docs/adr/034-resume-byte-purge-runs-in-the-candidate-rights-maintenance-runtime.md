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
