# D3-012 Application Preparation and Submission Approval Packet

- Status: Prepared for accountable review. This document is an engineering input, not legal advice
  or an approval. No disposition below has been requested from or granted by any reviewer.
- Task: D3-012. Release gates: LR-D3-01 (application preparation) and LR-D3-02 (application
  submission) in the [legal review register](../product/foundation/legal-review-register.md).
- Prepared: 2026-09-18
- Live ATS effects, automated form actions, and any real AI provider stay disabled until every
  disposition here is recorded. Foundational counsel review is separately deferred to D6-016
  ([ADR-019](../adr/019-defer-foundational-counsel-review-to-public-launch.md)).

## Decisions requested

| # | Decision | Accountable reviewer | Blocks |
|---|---|---|---|
| 1 | AI processing: whether any model provider may receive candidate facts and job text, which provider and model, the data-processing terms, and the disclosure notice text | Counsel; security/privacy | Any real generation |
| 2 | Form actions: whether the extension may fill fields on Greenhouse, Lever, and Ashby application pages, per exact variant | Counsel (ATS/source terms); security/privacy | Any autofill |
| 3 | Sensitive fields: storage and reuse of restricted answers, and the separate-key boundary required by ADR-010 | Security/privacy | Answer vault and any packet holding restricted values with real data |
| 4 | Signatures, attestations, and CAPTCHA/MFA: confirm they are always direct candidate action | Counsel | Submission |
| 5 | Submission: whether a candidate-approved, hash-bound packet may be submitted on the candidate's behalf, and the evidence required for ambiguous results | Counsel; security/privacy | Any automated submission |
| 6 | The engineering defaults listed under "Defaults to confirm" | Product owner | Release |

## What is implemented (locally verified with generated-synthetic data only)

| Control | Where | Evidence |
|---|---|---|
| Restricted answers always shown; never-infer answers dropped unless candidate supplied; attestations/signatures/challenges are direct action | Applications field policy | 41 unit tests |
| Immutable packet with content hash; approval bound to job revision, form hash, artifact hashes, and a 24-hour limit; any change invalidates | Applications packet and store | Unit and PostgreSQL integration tests |
| Write-ahead dispatch; ambiguous results block another submission until reconciled; database-level one-attempt-per-packet guard; crash recovery | Applications attempts and migration `0001` | Integration tests (race of 8, crash recovery) |
| Technical history ends at `applied`; no hiring-outcome vocabulary in code, schema, API, or events | Applications, OpenAPI, events | Contract and parity tests |
| Owner-scoped reads and writes; 404 for foreign ids; no values in history, outbox, receipts, or problem details | Store and gateway | Hardening and gateway tests |
| AI gateway default-off; just-in-time disclosure approval; confirmed non-restricted facts only; strict cited output; unsupported-claim checks; refusal for restricted/direct-action fields; always-reviewed drafts | `@ai-job-apply/ai-sdk`, ADR-030 (Proposed) | 22 tests including 11 adversarial output cases |
| Adapter registry requires kill switch, approved live effects, and unexpired QA-accepted provider-derived fixtures per variant | `@ai-job-apply/ats-sdk` | 15 tests |
| Assisted-manual fallback: no page action, no automated submission | ATS SDK | Tests |
| Review-by-exception UI with restricted answers always visible | Web panel | 10 tests incl. automated axe checks |
| Privacy-safe versioned measurement | Applications metrics | Tests proving no value or identifier is emitted |

## What is not implemented or not proven

- No real model, provider, or data-processing agreement exists; real-model factuality and
  injection resistance are unmeasured.
- No provider adapter exists (D3-013 fixtures are missing); no live form, submission, or
  confirmation detection has been exercised.
- The answer vault has no persistence, separate key, or API (blocked by D3-015 and D3-R4).
- Applications is not in candidate export, deletion, or restore (D3-014), the migration image, the
  restore manifest, Terraform/IAM, or any deployment (D3-015).
- No Auth0 `applications:*` scope, API Gateway route, BFF route, or extension integration exists.
- No durable workflow, outbox publisher, or alarm exists for Applications.
- Accessibility was checked only by automated jsdom axe rules (no color contrast, no real browser,
  no assistive technology).

## Defaults to confirm (all currently engineering choices)

- Approval lifetime 24 hours; auto-review confidence threshold 0.90.
- One live application per candidate and job; cancellation is impossible once a submission is in
  flight.
- A candidate-attested "not submitted" reconciliation requires an explicit duplicate-risk
  acknowledgement; `user_attested` confirmation is its own evidence kind.
- Approval evidence is the Applications approval record; no separate Profile consent ledger.
- Fact confidence by provenance (typed 1.00, resume with spans 0.95, without 0.90, derived 0.85).
- AI disclosure approval lifetime 15 minutes.

## Threats and questions for the security/privacy reviewer

1. Packets can hold restricted answers under database-level encryption only. Is envelope encryption
   with a separate key required before any real-candidate use (ADR-010 says yes)?
2. The extension reports submission results from the candidate's own browser. Is candidate-reported
   confirmation acceptable as evidence, given it is treated as candidate-observed, not provider truth?
3. Generated text reaches an employer under the candidate's name. What disclosure and review UX
   satisfies the AI-disclosure requirement?
4. What retention applies to packets, attempts, and history after `applied`, and how do export,
   deletion, and restore reconcile with append-only records?
5. Does the on-demand active-tab form reading required by the assisted-manual fallback fit the
   extension permission and store-review posture (LR-D2-02)?

## Requested record per decision

Reviewer name and accountable role, scope and artifact commit reviewed, jurisdiction and source-policy
versions, permitted and prohibited behaviors, conditions with owners and closure evidence, revalidation
trigger, and the product owner's acknowledgement of conditions, as required by the legal review register.
