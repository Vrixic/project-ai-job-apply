# ADR-028: Separate private saves, public contributions, Jobs truth, and UGC trust

Status: Accepted
Date: 2026-09-01

## Context

Phase 2 adds a browser extension and user-initiated public job contributions. A private save is
Confidential candidate activity; a contribution contains selected Public job fields plus a
Confidential contributor association and consent reference. Community observations can be
malicious, stale, ambiguous, or lower-authority than an existing provider source. The current Jobs
catalog treats accepted provider observations as positive verification, so routing unreviewed UGC
through that path could activate a listing, refresh its lifetime, or overwrite stronger
provenance.

The extension must also survive service-worker suspension and offline use without turning a retry
into a duplicate save or contribution. D1 scopes, clients, policies, and moderation decisions grant
no D2 authority.

## Decision

1. Private save and public contribution are separate commands and visible actions. A successful
   private save never implies contribution consent, and contribution failure never removes an
   acknowledged private save.
2. The extension inspects only the explicitly activated current tab. It sends only a strict
   allowlist of fields that the candidate previewed and retained. It never sends raw DOM, HTML,
   browsing history, cookies, request headers, authentication material, form values, or private
   notes.
3. Normal contribution processing retains no raw page snapshot. The separate authorized-provider
   fixture process may quarantine a restricted raw capture for at most 30 days under ADR-021; that
   evidence never enters the contribution API or ordinary application stores.
4. Profile owns immutable `ugc_contribution` consent records. The contribution binds an exact
   consent identifier, current policy version, extension client surface, and server-recomputed
   digest of the final preview payload. Publication rechecks that binding and fails closed if it is
   missing, revoked, superseded, or mismatched.
5. Jobs owns the sanitized payload, contribution processing state, normalized observation,
   verification evidence, canonical-source linkage, lifecycle result, atomic idempotency response,
   and identifier-only outbox event. Jobs may retain the internal owner identifier required for
   owner-scoped status, export, and deletion, but no public projection or event exposes it.
6. Trust owns contributor reputation, abuse/sanction evidence, UGC moderation, takedown, removal,
   withdrawal, and appeal decisions. Until that boundary is implemented, contributions may remain
   queued or `needs_review`; they may not be published through a substitute D1 moderation rule.
7. UGC observations are append-only evidence separate from provider source evidence. They cannot
   overwrite provider provenance, replace stronger canonical truth, activate a job, refresh
   `last_verified_at`, or extend expiry until an independent verification and applicable Trust
   decision pass. Conflicts prioritize review instead of mutating catalog truth.
8. `POST /v1/jobs/contributions` uses the dedicated `jobs:contribute` scope, one client-generated
   contribution UUID, and an `Idempotency-Key`. Same owner, semantic identity, and request digest
   replay the original acknowledgement; any changed payload conflicts. Events carry identifiers
   only.
9. The extension pending queue uses stable semantic identities, bounded backoff, worker-restart
   recovery, and account/session fencing. Logout or identity change stops delivery without
   silently assigning work to another user.
10. Contribution intake, processing, provider detectors, and store distribution remain independently
    default-off. Exact client-version and domain/variant kill switches must disable the extension
    capability without disabling the web catalog or private saved-job service.

## Consequences

- Phase 2 requires new contracts, consent persistence, Jobs migrations, identifier-only events,
  Trust decisions, lifecycle processing, deletion/export coverage, and browser assurance.
- A queued acknowledgement proves durable intake only; it does not claim verification,
  publication, or canonical-job creation.
- Community observations can improve freshness and review priority while never becoming automatic
  source truth.
- Public contribution and store distribution remain blocked on D2-010. Provider detector
  activation remains blocked on D2-011. Synthetic/default-dark engineering may proceed.
- The narrower payload and zero ordinary raw-snapshot retention reduce privacy and injection risk
  but require detectors to produce enough structured evidence for server verification.

## Alternatives

- **Send the full page for server extraction.** Rejected because it expands browsing, form,
  authentication, copyright, retention, and prompt-injection exposure.
- **Treat a contribution as a verified catalog observation.** Rejected because community input is
  not independent source verification and could overwrite provider truth.
- **Combine save and contribution into one consent.** Rejected because private interest must remain
  private by default.
- **Reuse D1 report/moderation decisions as UGC authority.** Rejected because provider correction
  and contributor reputation, licensing, withdrawal, takedown, and appeal have different owners and
  policy gates.
