# ADR-020: Defer accountable foundation security/privacy review to launch

Status: Accepted
Date: 2026-08-12

## Context

Phase 0 built and deployed a synthetic-only engineering foundation, prepared its complete
security/privacy review package, and completed a fresh engineering pre-audit. The pre-audit covers
dependencies, authentication and authorization, owner isolation, infrastructure policy,
credential-pattern hygiene, fixtures, pinned static analysis, builds, tests, recovery, and the
known limitations that remain behind release gates.

Named accountable human reviewers have not dispositioned the foundation. D6 already requires an
independent, open-book assessment and penetration test of the exact public-launch candidate under
ADR-015. Requiring a separate external disposition now would assess a deliberately incomplete,
synthetic-only product and would not replace the exact-candidate review.

## Decision

D0-015 is removed from Phase 0 rather than marked approved. Its engineering pre-audit, control
matrix, foundation documents, deployed evidence, and accountable-review template become mandatory
inputs to D6-015. The independent D6 assessor must review both the inherited foundation and the
finished web, API, mobile, extension, application-agent, cloud, provider, data, recovery, incident,
and business-logic surfaces.

Phase 0 may close after the remaining Phase 0 tasks pass without an accountable security/privacy
approval claim. Until D6-015 and each owning-delivery delta gate pass:

- shared environments remain synthetic-only;
- no real candidate onboarding, public source ingestion, public UGC, AI processing, ATS action,
  remote browser, outreach, billing, mobile distribution, or production launch is authorized;
- dedicated staging/production identity, rights/export/deletion, staffed incident/vulnerability
  operations, subprocessor approval, and launch recovery evidence remain mandatory; and
- Critical or High launch-candidate findings cannot be accepted, material fixes require
  independent retest, and every accepted Medium must be time-bounded with compensating controls.

## Consequences

- D0-015 is `Removed`; the passed engineering pre-audit is retained as evidence, not approval.
- D6-015 explicitly inherits FR-01–FR-13, the deployed-evidence matrix, known limitations, and any
  future material changes to them.
- Capability-specific security/privacy reviews remain owned by D1–D7 and can block activation well
  before the final launch review.
- D6 cannot complete without named independent assessment, remediation, retest, privacy/security
  disposition, and product-risk-owner sign-off against one immutable release candidate.
- The transfer does not weaken ADR-015 or permit repository agents to self-certify approval.

## Alternatives

- **Mark D0-015 approved from automated and engineering evidence.** Rejected because evidence and
  repository authorship do not constitute accountable human disposition.
- **Require a separate accountable external foundation review now.** Rejected by the product owner
  because the system is synthetic-only and an exact-candidate independent review remains mandatory.
- **Remove accountable security review entirely.** Rejected because the finished product exposes
  sensitive identity, career, automation, provider, and irreversible-action boundaries that require
  independent adversarial assessment before launch.
