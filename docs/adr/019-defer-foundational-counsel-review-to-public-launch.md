# ADR-019: Defer foundational counsel review to public launch

Status: Accepted
Date: 2026-08-12

## Context

Phase 0 prepared a complete foundational legal/privacy review package, but the product owner has
decided that retaining external counsel is not necessary during the synthetic-only engineering
foundation. No accountable legal conclusion exists, and repository authors cannot truthfully mark
the prepared review as approved.

The product still needs enforceable boundaries for real candidate data, source ingestion, public
UGC, ATS actions, outreach, billing, mobile stores, public representations, and launch. Deferring
the general counsel review must not silently authorize any of those capabilities or erase their
delivery-specific gates.

## Decision

D0-014 is removed from Phase 0 rather than marked complete. Its review-ready worksheet and legal
register remain the input package for a new mandatory D6 public-launch task. D6 may not complete
and the product may not launch publicly until qualified counsel reviews the then-current product,
jurisdictions, providers, notices, terms, data flows, and release candidate and records an
attributable disposition.

Phase 0 proves that legal/privacy questions are identified and assigned to enforceable gates; it
does not claim legal approval. D0 security/privacy review may assess the engineering design without
waiting for counsel, but it may not make legal conclusions. Any unresolved legal dependency must
remain attached to the capability that would activate it.

Until the owning delivery's legal/provider gate is satisfied:

- shared development and staging remain synthetic-only;
- no public source ingestion or public UGC is enabled;
- no live ATS action, automated submission, outreach, billing, mobile-store release, or public
  compliance claim is authorized; and
- representative provider-derived fixtures still require explicit source authorization,
  sanitization, security/privacy review, and separate QA acceptance.

## Consequences

- Phase 0 is no longer blocked solely on retaining external counsel.
- The prepared LR-F01–LR-F07 worksheet remains `Not reviewed`; it is not rewritten as approval.
- D6 gains a blocking foundational counsel-review task and exit criterion.
- Delivery-specific legal and provider reviews remain in D1–D7 and may block capabilities before
  D6.
- Material product, jurisdiction, provider, or data-flow changes must be included in the eventual
  review instead of relying on the 2026 Phase 0 package unchanged.

## Alternatives

- **Record D0-014 as complete without counsel.** Rejected because it would manufacture an
  accountable legal disposition that does not exist.
- **Keep external counsel as a Phase 0 blocker.** Rejected by the product owner because the current
  environment is synthetic-only and public launch is not imminent.
- **Remove legal review entirely.** Rejected because real-data activation, external actions, public
  terms, and nationwide US launch still require accountable review of concrete behavior.
