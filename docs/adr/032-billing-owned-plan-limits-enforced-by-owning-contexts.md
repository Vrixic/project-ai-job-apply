# ADR-032: Billing-owned plan limits, enforced atomically by the owning context

Status: Proposed (product-owner acceptance pending)
Date: 2026-09-20

## Context

The product must limit how many resumes a candidate can keep, and that limit will depend on the candidate's
plan once billing is implemented. Entitlements today ([Billing](../../backend/services/billing/README.md)) are
boolean capability grants that are identical for Free and Pro, so there is no way to express a quantity. A limit
also has to hold under concurrent requests, so it cannot be a check the Gateway makes before calling the owning
module. Separately, only one resume may be in the upload, scan, and parse pipeline at a time so a candidate cannot
start a second while the first is unfinished.

## Decision

1. **Billing owns the limits.** A pure, versioned table maps each plan to its limits (`planLimits`, first entry
   `maxStoredResumes`). Every valid entitlement evaluation carries the limits of the plan it evaluated, so cache,
   grace, and expiry behavior apply unchanged: an expired Pro subscription evaluates as Free and gets Free limits.
   Limits are derived from the plan, not stored per account, so no migration and no per-account override exist yet.
2. **The owning context enforces its limit.** Documents enforces the resume limit inside the transaction that
   registers an upload, behind a narrow `ResumeLimits` port. The Gateway composition implements the port from
   Billing, so Documents never imports Billing. The count and the insert are serialized per candidate with an
   advisory lock, so two concurrent uploads cannot both pass.
3. **Fail closed.** If limits cannot be evaluated the upload is refused with `entitlement_unavailable`; it is never
   allowed by default. An idempotent replay of an earlier registration is returned before any limit check.
4. **What occupies a slot.** A resume occupies a slot while it is uploading, scanning, parsing, or parsed. Failed and
   rejected documents free their slot. A registration whose upload grant has expired and whose scan margin has passed
   (15 minutes) is abandoned: the next registration marks it failed, so an abandoned attempt never blocks the
   candidate for the 30 minutes the processing reconciler would otherwise take.
5. **One upload in progress, on every plan.** While any of the candidate's documents is uploading, scanning, or
   parsing, a new upload is refused with `resume_upload_in_progress`. This is a pipeline rule, not a billing gate.
6. **Values.** Free allows one stored resume. Pro allows two (decided 2026-10-22 under D6-008, so the one paid product
   has a visible benefit; the owner chose two over the earlier proposal of five); changing either is a one-line
   table change with a test.
7. **Contract.** `GET /v1/entitlements` gains an optional `limits` object (additive, same version). Refusals reuse
   the existing `409` problem type with the codes `resume_document_limit` (limit reached) and
   `resume_upload_in_progress`. The web app gates the upload control from the documents list and the limits, and
   the server remains authoritative.

## Consequences

- Adding a plan or a limit changes Billing's table and the consuming context's port use, not the Gateway or the
  database.
- With a limit of one there is no way yet to replace or remove a parsed resume; a delete or replace action is the
  natural follow-up and is not part of this decision.
- Tighter than before for abandoned uploads: a document still unscanned 15 minutes after registration is treated as
  failed by the next registration, and its late scan result is ignored because the document is terminal.
- Limits are advisory for the UI and authoritative only where the owning context enforces them.

## Alternatives

- **Check the limit in the Gateway before calling Documents.** Rejected: not atomic, so concurrent requests exceed it.
- **Model the limit as a capability grant.** Rejected: grants are boolean and identical across plans today.
- **Store per-account limits.** Deferred until billing needs overrides; the plan table is enough now.
- **Let Documents read Billing directly.** Rejected: it breaks module data ownership.
