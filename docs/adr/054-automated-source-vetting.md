# ADR-054: Automated vetting of contributed job sources

Status: Accepted by the owner's direction 2026-10-22; code in progress, no deployment
Date: 2026-10-22

## Context

D1-011 was removed because the owner wants contributed job sources vetted by an automated AI
system instead of a human moderator (D7-012). Three existing rules constrain it:

1. The Trust state machine accepts a contribution only on a reviewer's decision backed by independent
   provider evidence: a fresh digest produced by the deterministic verification pipeline (the
   ingestion worker fetches the provider's own public data and compares it). A contributor's claim
   alone never counts.
2. The model gateway (ADR-029 family) exists for candidate disclosures. Its purposes are
   `cover_letter` and `narrative_answer`, and every call needs a just-in-time candidate approval.
3. Adverse outcomes (reject, take down) carry appeal rights and a named human reviewer.

## Decisions

1. **The AI may accept; it never rejects.** An automated reviewer, a fixed system identity distinct
   from every human, may record an `accepted` initial-review decision with reason
   `independently_verified` only when (a) the model's assessment is `accept` with no concerns and
   confidence at or above 0.9, and (b) Trust itself verifies the independent provider evidence for that
   case (the existing `acceptedProviderBasis` check, unchanged). Every other outcome (a concern, low
   confidence, a model or dependency failure, a stale or missing proof) leaves the case in the human
   review queue exactly as before. There is no automated reject, take-down or appeal decision.
2. **A separate source-vetting path, not the candidate-disclosure gateway.** Vetting reads only the
   contributed public job posting (provider, source URL, title, company, description, locations, work
   mode, employment type). No candidate data and no contributor identity reach the model, so no
   candidate disclosure approval applies and none is faked. The path has its own kill switch, default
   off, a hard timeout, bounded input and output, and strict enumerated JSON output. Because the output
   is enumerations only, text inside a posting cannot make the model emit an instruction.
3. **Zero provider retention.** The provider request sets `store: false`. Account-level zero data
   retention with the provider is an owner action; the code cannot establish it.
4. **Audit.** Every assessment and decision writes an audit record through an injected sink: case id,
   contribution id, evidence digest, the assessment (decision, concern codes, confidence), model
   identity, prompt version, and the outcome (`accepted`, `deferred`, `conflict`, `unavailable`). It
   holds no posting text. An accepted decision is also a normal Trust case event naming the automated
   reviewer. The first sink writes structured log lines; a durable table needs the owner's
   schema approval and is not part of this change. No acceptance happens unless its assessment audit
   record was written first.
5. **Authority is explicit.** The automated reviewer identity must be authorized by the runtime
   reviewer-authority port for case reading and initial review, and nothing else. Unauthorized or
   unconfigured, the service does nothing. Human reviewers keep every other role, and a human can still
   take down or appeal-reverse an accepted contribution.

## Not decided here

The host that runs the vetting step (a scheduled worker) is an AWS addition, and enabling the kill
switch in any environment is a separate owner action.
