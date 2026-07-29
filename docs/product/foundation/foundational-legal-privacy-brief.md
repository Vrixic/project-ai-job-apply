# Foundational Legal and Privacy Review Brief

- Status: Review preparation in progress; no legal conclusion or approval recorded
- Prepared: 2026-07-28
- Accountable reviewer: Future external legal/privacy counsel; individual unassigned
- Product owner: Founder/repository owner; legal name to record before approval

This brief gives accountable counsel a bounded Phase 0 review request. It describes engineering
intent and asks counsel to determine the applicable obligations. It is not legal advice and does
not authorize production processing or external actions.

## Review objective

Approve, reject, or condition the foundational assumptions that later deliveries depend on:

1. ApplyDash acts only on behalf of a candidate and ends its product workflow at confirmed
   application submission.
2. Candidate facts, documents, answers, approvals, and credentials are processed only for
   candidate-requested application activity.
3. Saving a job privately, contributing public job data, preparing an application, submitting an
   application, and sending outreach are separate actions with separate authorization.
4. The platform may maintain a canonical job catalog only from sources and contributions whose
   terms and rights have been reviewed.
5. Data collection, disclosure, retention, export, correction, and deletion follow documented
   purpose limitation and data-minimization rules.
6. Feature-specific legal conclusions remain blocking gates in the delivery that implements the
   feature.

## Fixed product facts

- Initial audience: US-English early- and mid-career software, data, and product professionals.
- Intended launch coverage: nationwide United States.
- Minimum user age: 18.
- `Vrix LLC` is the provisional future entity/sponsor name. No legal entity has been formed, and
  documentation must not represent otherwise.
- Candidate-first purpose: rapidly prepare and submit truthful, tailored applications.
- Terminal product state: confirmed submission.
- Excluded behavior: coaching, interview preparation, inbox/calendar reading, employer-side
  surveillance, and collection of interviews, recruiter responses, offers, rejections, or other
  post-submission outcomes.
- The system must not invent candidate facts, infer sensitive answers, bypass CAPTCHA/MFA, or
  silently accept attestations or electronic signatures.
- Approval applies to an immutable application packet; a material change invalidates approval.
- User-supplied restricted answers may be stored in a dedicated encrypted vault, but every use is
  shown during the application's final review and requires approval as part of the immutable packet.
- Confirmed account deletion is not recoverable; inaccessible backup copies age out within the
  documented 35-day window.
- Generated application artifacts remain until the user deletes them or deletes the account.
- Phase 0 uses operational telemetry only. Optional product analytics require a later explicit
  preference and applicable review.
- Development and staging use synthetic data until the foundational privacy gate permits another
  class of data.

## Decisions required from the product owner

| ID | Decision | Current value |
|---|---|---|
| LP-D01 | Legal entity name and formation/operating jurisdiction | No entity formed; `Vrix LLC` is a provisional future name; formation jurisdiction deferred |
| LP-D02 | Initial user residency and excluded jurisdictions | Nationwide United States intended; counsel must enumerate state, DC, territorial, and other jurisdictional obligations |
| LP-D03 | Minimum user age | 18 |
| LP-D04 | Accountable reviewers | Founder accepts product risk; future external counsel and independent security reviewer must be assigned |
| LP-D05 | Whether the strict synthetic-only pre-approval gate is accepted | Staged policy accepted: synthetic shared environments; isolated founder-only real-data use; adapter-gated founder live submissions |
| LP-D06 | Restricted-answer storage and reuse | Store user-supplied values in the restricted vault; never infer; always show during final application review |
| LP-D07 | Account-deletion recovery window | No recovery after confirmed deletion; active access ends immediately and backups age out within 35 days |
| LP-D08 | Default generated-artifact retention | Until the user deletes the artifact or account |
| LP-D09 | Optional product analytics consent model | Phase 0 operational telemetry only; optional product analytics later require an explicit preference |

## Approved pre-approval development modes

LP-D05 is resolved. The following staged policy allows most of the product to be built before entity
formation without treating early development as a public service:

| Mode | Permitted data and behavior | Prohibited behavior |
|---|---|---|
| Shared development, CI, staging, demos | Synthetic candidate data, synthetic ATS fixtures, public non-ingested examples with permission | Real candidate PII, raw user artifacts, production ingestion, public UGC, live external effects |
| Isolated founder dogfooding | Only the founder's own candidate data; local or dedicated isolated environment; encrypted storage; redacted telemetry; explicit cleanup; document generation and review UX | Invited-user data, public UGC, mailbox connection/outreach, unapproved ATS actions, bypassing provider controls, production/compliance claims |
| Adapter-gated founder live pilot | Founder-only submission using the founder's own data and account after the exact ATS/variant passes every pilot gate below | Other users, unapproved ATS/variants, bulk activity, CAPTCHA/MFA bypass, blind retries, outreach, public release |
| Closed alpha | Only after entity formation, foundational legal/privacy and security approval, managed identity, deployed access controls, rights/deletion tests, incident ownership, and approved providers | Any capability whose delivery-specific gate remains open |
| Public production | Only capabilities with foundational and delivery-specific approvals plus deployed evidence | Unapproved source/provider/ATS/permission/jurisdiction |

Founder dogfooding permits testing personalization with the founder's own truthful data. Live ATS
effects remain prohibited until an adapter-specific pilot release record proves all of the
following:

- written legal/terms disposition for the exact source, ATS, behavior, and account context;
- founder ownership/control of the candidate data, destination account, and application;
- isolated environment, strong founder authentication, encrypted secrets/data, redacted telemetry,
  cleanup, and incident/kill-switch ownership;
- supported ATS/variant declaration with sanitized fixtures and passing conformance tests;
- immutable packet hash, visible final review, explicit single-use submission approval, and
  revalidation immediately before the external effect;
- mandatory review of every restricted answer and direct founder takeover for CAPTCHA, MFA,
  signatures, attestations, ambiguity, or changed questions;
- scoped idempotency, duplicate prevention, bounded retry, cancellation, and no blind retry after an
  ambiguous response;
- confirmation evidence, reconciliation/manual fallback, versioned audit evidence, and a remotely
  operable adapter/variant kill switch; and
- an approved pilot release record naming the legal/security reviewers, evidence versions,
  conditions, residual risks, and expiry/revalidation trigger.

Passing one adapter/variant does not authorize another. The exception never authorizes processing
another person's data, inviting alpha users, bulk applications, public UGC, outreach, or a public
service.

## Questions for counsel

### Product role and candidate authorization

- How should the service describe its role when it prepares or submits an application at the
  candidate's direction?
- Which terms, disclosures, affirmations, or records are required to establish the candidate's
  authority and intent?
- Which application fields, signatures, attestations, or employer questions must always require
  direct candidate action?
- Does the planned activity create employment-agency, automated-employment-decision, consumer
  reporting, power-of-attorney, electronic-signature, or similar obligations in the launch
  jurisdictions?

### Candidate privacy

- Which federal and state privacy, consumer-protection, breach-notification, employment, biometric,
  accessibility, and sensitive-data rules apply to the entity, audience, and processing described
  here?
- Are the proposed data classes, purposes, consents, disclosures, retention periods, rights
  workflow, and subprocessor controls sufficient?
- What privacy notice, terms, just-in-time notices, cookie/analytics choices, and service-provider
  contract language are required before collecting real candidate data?
- Which data may be treated as sensitive or health-related even when supplied voluntarily on an
  employer application?
- What response periods, identity verification, exceptions, and records are required for access,
  correction, export, and deletion requests?

### Source and community data

- For each source, may the platform retrieve, normalize, store, display, redistribute, and retain
  posting fields, descriptions, URLs, and provenance?
- What contributor license and representations are required for a user to contribute public job
  information?
- What notice, takedown, counter-notice or appeal, repeat-abuse, provenance, and rights-owner
  process is required?
- Which source content may remain as a non-public or public tombstone after expiry or takedown?

### Truthful automation and fairness

- Are the prohibitions on invented facts, inferred sensitive answers, hidden submissions, and
  bypassing site security sufficient?
- Which disclosures or controls are required for AI-assisted document generation and form
  completion?
- What accessibility and nondiscrimination reviews are required for candidate ranking,
  recommendations, document tailoring, and application automation?

## Requested written output

For each foundational question, counsel should provide:

- jurisdiction, authority, source-policy version, and review date;
- permitted, prohibited, and conditional behavior;
- required product copy, consent, contract, operational process, and record;
- accountable implementation owner and revalidation trigger/date;
- explicit approval, rejection, or residual risk requiring product-owner acceptance.

An approval is not valid if it only says “reviewed.” It must identify its scope, assumptions,
conditions, reviewer, date, and the artifact versions reviewed.

## Pre-approval operational gates

The current D0 implementation has no qualifying adapter pilot, so its strict gate remains active.
Until the applicable row receives accountable written approval:

- use synthetic candidate and ATS data in shared development, CI, staging, and demos;
- use real data only under the isolated founder-only modes above;
- do not ingest production job sources;
- do not accept public UGC;
- do not perform live ATS form actions or submissions except through an approved, unexpired
  adapter-gated founder pilot;
- do not connect email accounts or send outreach;
- do not distribute browser or mobile applications through public stores; and
- do not make public compliance, security, or privacy claims.

## Feature-specific reviews intentionally deferred

| Delivery | Review immediately before activation |
|---|---|
| D1 | Each job-source license/terms, public catalog display, privacy notice, real candidate onboarding |
| D2 | Contribution license, takedown operation, extension permissions/disclosures, store policies |
| D3 | ATS-specific terms, candidate authorization, signatures/attestations, AI disclosures |
| D4 | Workday-specific behavior, remote-browser processing, credential/session handling |
| D5 | Contact-source rights, anti-spam rules, send-only OAuth, provider acceptable-use terms |
| D6 | Mobile privacy, account deletion, billing, subscription, and storefront rules |
| D7 | Each new country, source, ATS, data use, or employer-side capability |

Deferral is not permission. Each owning delivery must keep the capability disabled until its review
record is approved.

## Engineering evidence supplied to reviewers

- [Product and system architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md)
- [Legal and policy review register](legal-review-register.md)
- [Launch decision](launch-decision.md)
- [Threat model](../../security/threat-model.md)
- [Privacy impact assessment](../../security/privacy-impact-assessment.md)
- [Data flow and classification](../../security/data-flow-and-classification.md)
- [Consent model](../../security/consent-model.md)
- [Retention and deletion](../../security/retention-and-deletion.md)
- [Subprocessor register](../../security/subprocessors.md)
- [Security and privacy approval plan](../../security/security-privacy-approval-plan.md)

## Authoritative guidance used to prepare the questions

These sources guide the engineering questions; they do not replace jurisdiction-specific counsel:

- [FTC data-security guidance](https://www.ftc.gov/business-guidance/privacy-security/data-security)
- [FTC guide to protecting personal information](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business)
- [NIST Privacy Framework lifecycle guidance](https://www.nist.gov/privacy-framework/using-privacy-framework-11)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)

## Review record

| Field | Value |
|---|---|
| Reviewer and accountable role | Pending |
| Entity and launch jurisdictions | Entity not formed; `Vrix LLC` provisional; nationwide US intended |
| Version/commit reviewed | Pending |
| Review date | Pending |
| Result | Not reviewed |
| Conditions or required changes | Pending |
| Product-owner residual-risk acceptance | None |
| Revalidation trigger/date | Pending |
