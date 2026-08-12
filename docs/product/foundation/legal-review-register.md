# Legal and Policy Review Register

- Status: Review ready; accountable counsel is not yet assigned
- Accountable role: Legal/privacy counsel
- Last updated: 2026-08-11

Repository documents are engineering inputs, not legal advice. The
[foundational review brief](foundational-legal-privacy-brief.md) contains the product facts,
questions, and requested conclusions. The
[foundational disposition worksheet](foundational-legal-privacy-disposition.md) fixes the reviewed
artifact set and records attributable LR-F01–LR-F07 dispositions, findings, conditions, cross-review
handoffs, and sign-off. Neither document authorizes processing or external actions on its own.

## State vocabulary

- `Review ready` means the engineering package exists; it is not approval.
- `Not reviewed` means no accountable counsel disposition exists and the listed release consequence
  remains active.
- `Approved`, `Approved with conditions`, and `Rejected` may be recorded only from the completed,
  attributable counsel disposition defined in the worksheet.
- A condition closes only when its owner supplies the required evidence and the accountable
  reviewer accepts it. Product-owner risk acceptance cannot substitute for counsel disposition.

## Phase 0 foundational review

| ID | Area | Required review | Evidence package | Counsel disposition | Release consequence while open |
|---|---|---|---|---|---|
| LR-F01 | Entity, audience, and launch jurisdiction | Entity/operating assumptions, minimum age, covered/excluded US jurisdictions, obligations and formation prerequisites | Brief, launch decision, privacy assessment | Not reviewed; counsel unassigned | Strict pre-approval gate; no public launch |
| LR-F02 | Candidate privacy | Notices, sensitive data, rights, subprocessors, retention/deletion, breach, analytics, residency and transfer requirements | Privacy assessment, data map, consent, retention, subprocessors | Not reviewed; counsel unassigned | Synthetic-only shared environments; no real candidate onboarding |
| LR-F03 | Candidate-directed service | Product role, authorization, terms, disclosures, employment/intermediary and consumer-protection implications | Architecture, brief, consent model | Not reviewed; counsel unassigned | No live form actions or submissions outside an independently approved exact founder-pilot gate |
| LR-F04 | Consent and electronic action | Separate preparation/submission/outreach consent, signatures, attestations, immutable approval evidence and revocation | Consent model, restricted-answer and founder-pilot ADRs | Not reviewed; counsel unassigned | Simulated external effects only outside an independently approved exact founder-pilot gate |
| LR-F05 | Source/UGC governance model | Rights-evaluation method, contributor license, provenance, takedown/appeal, abuse, retention and tombstones | UGC ADR, data map, retention specification | Not reviewed; counsel unassigned | No production ingestion or public UGC; synthetic ATS fixtures only until representative-fixture acquisition is separately approved |
| LR-F06 | Truthful automation and fairness | AI disclosures, sensitive-answer boundaries, accessibility, nondiscrimination and human-review requirements | Architecture, privacy assessment, restricted-answer ADR | Not reviewed; counsel unassigned | Synthetic evaluation only; no unreviewed AI provider or live automation activation |
| LR-F07 | Public terms and representations | Terms, privacy/just-in-time notices, cookie/analytics choices, claim substantiation and revalidation | Brief, consent model, this register | Not reviewed; counsel unassigned | No public compliance claims or launch |

## Feature-specific release reviews

These reviews are intentionally assigned to the delivery that produces concrete behavior. They are
not part of foundational approval, and deferral does not authorize the capability.

| ID | Delivery | Area | Required review | State | Release consequence |
|---|---|---|---|---|---|
| LR-D1-01 | D1 | Greenhouse public Job Board API | Terms, attribution, storage, redistribution, revalidation | Not started | No production ingestion |
| LR-D1-02 | D1 | Lever Postings API | Terms, attribution, storage, redistribution, revalidation | Not started | No production ingestion |
| LR-D1-03 | D1 | Ashby public Job Postings API | Terms, attribution, storage, redistribution, revalidation | Not started | No production ingestion |
| LR-D1-04 | D1 | Real candidate onboarding | Final notice, rights, analytics and deployed privacy controls | Not started | Synthetic accounts only |
| LR-D2-01 | D2 | User-contributed listings | Contribution license, provenance, takedown, appeal, contributor privacy | Not started | No public UGC |
| LR-D2-02 | D2 | Chrome/Edge extension | Minimum permissions, browsing-data disclosures, store terms | Not started | No store release |
| LR-D3-01 | D3 | Application preparation | ATS/source terms, candidate authorization, attestations, AI disclosure | Not started | No live ATS form actions |
| LR-D3-02 | D3 | Application submission | Approval record, signatures, CAPTCHA/MFA, ambiguous confirmation | Not started | No automated submission |
| LR-D4-01 | D4 | Workday and remote browser | Access authorization, automation limits, tenant differences, session processing | Not started | Synthetic fixtures and isolated simulation only |
| LR-D5-01 | D5 | Personalized outreach | Contact-source permissions, anti-spam rules, send-only OAuth, approved sending | Not started | Draft-only prototypes |
| LR-D6-01 | D6 | iOS/Android and billing | Store privacy, account deletion, subscription/payment and storefront rules | Not started | No store release |
| LR-D7-01 | D7 | New country/source/ATS/employer capability | Jurisdiction- and capability-specific delta review | Not started | Capability/region disabled |

## Required evidence per row

- Exact repository commit and artifact manifest
- Counsel/reviewer name, accountable role, scope, and attributable signed/external record
- Jurisdiction, authority, and relevant source/provider-policy version/date reviewed
- Permitted and prohibited behaviors
- Required attribution, consent, disclosure, retention, and takedown behavior
- Finding/condition IDs with owners, affected gates, closure evidence, and state
- Revalidation trigger/date and owner
- Written disposition plus product-owner acknowledgement of scoped conditions and eligible residual
  risks

No row may be marked `Approved` based solely on an engineering interpretation. Foundational
approval does not close any feature-specific row below.

## Review history

| Date | Change | Evidence |
|---|---|---|
| 2026-07-28 | Split foundational review from feature-specific release review and prepared a bounded counsel brief. No legal conclusion was made. | [Foundational review brief](foundational-legal-privacy-brief.md) |
| 2026-07-28 | Recorded nationwide US/18+ direction, provisional unformed `Vrix LLC`, founder risk ownership, restricted-answer review, deletion/artifact defaults, and Phase 0 analytics boundary. LP-D05 remains under discussion. | [Foundational review brief](foundational-legal-privacy-brief.md) |
| 2026-07-28 | Resolved LP-D05 with synthetic shared environments, isolated founder-owned data, and exact-adapter founder live pilots only after written legal/terms, security, approval, duplicate-safety, confirmation, and kill-switch gates. No pilot is currently authorized. | [ADR-011](../../adr/011-staged-preproduction-data-and-founder-pilot.md) |
| 2026-08-11 | Added an exact-commit artifact manifest, deterministic disposition vocabulary, row-level conclusion record, condition/closure ledger, cross-review handoff, and attributable sign-off checklist. Clarified that pre-approval modes are product direction rather than counsel approval; all strict gates remain active. | [Foundational disposition worksheet](foundational-legal-privacy-disposition.md) |
