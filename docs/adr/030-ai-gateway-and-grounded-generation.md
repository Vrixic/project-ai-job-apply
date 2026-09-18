# ADR-030: AI gateway and grounded generation

Status: Accepted (product owner, 2026-09-18) for the gateway, grounding, and review architecture;
model and provider selection remain separately blocked on D3-012
Date: 2026-09-18
Accepted: 2026-09-18

## Context

D3 needs generated cover letters and narrative application answers. A model can state unsupported
facts, follow instructions embedded in a job posting, or draft an answer to a question that must
never be answered on the candidate's behalf. The product rule is that every generated claim traces
to confirmed candidate evidence or is flagged for review, and that restricted, attestation,
signature, and challenge answers are never silently produced ([ADR-010](010-restricted-answer-vault-and-mandatory-review.md)).
No AI provider, model, or processing agreement has been selected or approved, and LR-F06/LR-D3-01
keep unreviewed AI provider use and live automation disabled.

## Decision

1. All model use goes through `@ai-job-apply/ai-sdk`. Services and clients never call a provider
   directly. The gateway is off unless its explicit enable switch returns true, so generation is
   dark by default.
2. Every model call needs a just-in-time candidate disclosure approval for the exact purpose
   (`cover_letter` or `narrative_answer`) and the data categories placed in the prompt. Approval is
   short lived (15 minutes) and never reused for another purpose or category.
3. Only confirmed, currently usable, non-restricted facts are placed in a prompt. Job text is
   treated as untrusted data inside a delimiter that the posting cannot close.
4. The model returns strict JSON: paragraphs, each with the ids of the supporting facts. Input size,
   output size, and time are bounded, and provider errors are mapped to fixed codes with no provider
   text.
5. Output is accepted only if every paragraph cites usable confirmed facts and every number and
   every mid-sentence proper noun it states is present in those facts (or names the target job), and
   it contains no sensitive-attribute content. Any finding rejects the whole draft and withholds all
   of its text.
6. A draft that passes is `needs_review`, never approved: it enters an application packet as a
   `generated` field, which the packet policy always routes to the candidate's final review.
7. Narrative generation refuses restricted, never-infer, attestation, signature, CAPTCHA, and MFA
   fields before any model call.
8. Prompt version, model identity, and outcome are recorded per result so factuality and rejection
   rates are measurable by version ([D3-010](../product/delivery/phase-3-application-preparation.md)).
9. Provider and model choice, data-processing terms, and the disclosure notice text are decided
   only after counsel and security/privacy review (D3-012). Until then only offline fake providers
   exist; nothing in the repository calls a real model.

## Consequences

- A hallucinated employer, fabricated metric, uncited claim, or instruction-following injection
  cannot reach a candidate as a suggested claim, and cannot enter a packet.
- Deterministic checks are conservative: they can reject a truthful draft (for example an uncommon
  proper noun that is not in a cited fact). Rejection is safe; the candidate can write their own text.
- The checks do not judge quality, tone, or completeness, and they are not a substitute for candidate
  review or for evaluating a real model against representative data.
- The offline fakes cannot show real-model behavior, so real-model factuality and injection resistance
  remain unproven until an approved provider is evaluated.

## Alternatives

- **Let services call a provider SDK directly.** Rejected because disclosure approval, redaction,
  bounds, and version recording could not be enforced in one place.
- **Trust the model to cite honestly.** Rejected because citation is only evidence when it is checked
  against confirmed facts and the stated claims.
- **Auto-approve grounded drafts.** Rejected because grounded is not verified and generated text
  represents the candidate to an employer.
- **Fine-tune or retrieve over candidate documents.** Deferred: it widens the data-processing surface
  before any provider approval exists.
