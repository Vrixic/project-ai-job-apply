# ADR-038: One-off generated cover letters and improved resumes

Status: Accepted (product owner, 2026-10-04) for product retention direction; enforcement pending D3-064
Date: 2026-10-04

## Context

The owner requires AI-generated cover letters and AI-improved resumes to be one-off materials,
cleaned up after 30 minutes rather than saved for future use. This supersedes the generated-artifact
default of retention until account deletion in the architecture and privacy documents.
[ADR-031](031-deterministic-resume-tailoring-in-documents-runtime.md) already avoids persisting
deterministically tailored resumes; this decision adds a lifetime bound for the returned materials
and defines the policy for generative rewrites and cover letters. Current source-only cover-letter
work stores encrypted drafts and provider request/result slots. Those content-retention choices,
including the object-storage premise in proposed [ADR-037](037-precreated-cover-letter-provider-slots.md),
must be revised to satisfy this owner direction before activation. Existing isolation, positive
remote-settlement, deletion-fencing, and duplicate-prevention requirements remain necessary.

## Decision

1. Generated cover letters and improved/tailored resumes, including drafts, candidate edits to those
   drafts, rendered PDF/DOCX files, and content-bearing diffs, belong to one candidate and one
   application preparation. They are never a reusable document library or future-application source.
2. Their maximum lifetime is 30 minutes (1,800 seconds) from completion of generation. Access,
   candidate edits, approval, download, retries, and background work do not extend that deadline.
   Replacement generation gets a new deadline and requires fresh review/approval of its exact content.
3. Keep content only in bounded temporary memory during that window. Do not persist it in PostgreSQL
   (including packet fields, command/idempotency records, history, or export projections), object
   storage, durable workflow state, queues, logs, traces, analytics, provider caches, or backups.
   Clients must not save it in local storage, IndexedDB, service-worker caches, or persisted drafts.
   Any renderer scratch files must be deleted on success, failure, cancellation, and timeout within
   the same deadline. Responses containing these materials must use `Cache-Control: no-store`.
4. Enforce the deadline on every preview, download, approval, and submission handoff, and actively
   discard server/client temporary copies by that deadline, including while the UI is idle. Logout,
   cancellation, and completed submission discard platform copies sooner. Memory loss requires a
   new preparation; recovery must never reconstruct a persisted generated draft.
5. Applications may retain only content hashes and minimal non-content metadata (such as generation
   version, expiry, and technical submission state) needed for approval binding and duplicate
   prevention. Never embed generated material in a packet field or its snapshots. Expiry makes an
   unsubmitted packet unusable and invalidates its approval; a workflow must revalidate immediately
   before handing the material to the ATS. Expiry must not erase confirmed submission metadata or
   restart an ambiguous submission.
6. A candidate may download a copy during the window. The platform cannot delete that candidate-held
   file or a copy already delivered to the employer/ATS; disclose this limit without promising
   deletion outside the platform. Original uploaded resumes, normalized source documents, confirmed
   facts, candidate-authored answers, and account exports retain their separate policies.
7. AI-provider approval must establish no training and no retained candidate prompts/generated
   material beyond this window, including diagnostics and abuse logs. A provider unable to satisfy
   this policy must not be enabled for these tasks. D3-012's existing approval gates still apply.

## Implementation evidence and consequences

- The Documents runtime currently recomputes deterministic tailoring and persists only its hash
  ([ADR-031](031-deterministic-resume-tailoring-in-documents-runtime.md)). Its responses have no
  evidenced 30-minute client/server lifecycle enforcement yet.
- The offline AI SDK returns cover-letter text and `toGeneratedProposal` can shape it as a generated
  packet field. The Applications store persists packet fields as JSON. Connecting those paths would
  retain the letter despite storing a separate artifact hash; D3-064 must prevent this before release.
- Generative resume rewriting and a live cover-letter provider are not enabled. This ADR records
  the authorized product policy, not a completed cleanup implementation or deployment.
- Current `cover-letter-store.ts`, `cover-letter-objects.ts`, and isolated provider-slot paths
  persist encrypted generated content in S3 and recover saved drafts. That source behavior does
  not satisfy this decision, even though draft text stays out of SQL. D3-064 must redesign these
  paths and their export/read consumers, and account for any retained synthetic versions before
  activation. A local deadline is never proof that an authorized remote writer has stopped;
  failed cleanup must remain release-blocking without claiming deletion or redispatching work.
- [D3-064](../product/delivery/phase-3-application-preparation.md) requires expiry, no-content
  persistence, browser cleanup, packet invalidation, retry/ambiguous-submission safety, and
  provider-retention evidence before these materials are exposed to candidates.

## Rejected alternatives

- Retain generated documents until account deletion: contradicts the owner's one-off requirement.
- Save content in the database and delete it 30 minutes later: backups, snapshots, and packet history
  could retain it for much longer and it would still be saved in the database.
- Use object-store day-level lifecycle expiry or sliding idle expiry: neither enforces the absolute
  30-minute lifetime.
