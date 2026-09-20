# D3-012 Application Preparation and Submission Approval Packet

- Status: Prepared for accountable review. This document is an engineering input, not legal advice
  or an approval. No disposition below has been requested from or granted by any reviewer.
- Task: D3-012. Release gates: LR-D3-01 (application preparation) and LR-D3-02 (application
  submission) in the [legal review register](../product/foundation/legal-review-register.md).
- Prepared: 2026-09-18; refreshed to the implemented state and given the owner's positions on 2026-09-19
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

## Owner positions (2026-09-19; owner statements, not accountable approval)

The product owner gave these positions in chat. They are product direction for the reviewers to assess.
They are not a legal, security, or privacy disposition, and every reviewer record below is still required.

| # | Owner position | What it means for the review |
|---|---|---|
| 1 | AI processing is acceptable in principle and users will be told: candidate facts and job text may reach a model provider, with disclosure to the user. | No provider, model, data-processing terms, or disclosure text has been chosen; reviewers still decide and approve them before any real generation. |
| 2 | Filling fields on Greenhouse, Lever, and Ashby application pages is a given product requirement. | Reviewers still decide per exact variant and against each source's terms; no adapter exists until D3-013 fixtures do. |
| 3 | Sensitive answers are kept, and the owner does not expect any stored answer to be highly sensitive. | Restricted answers are still shown for review and never inferred. The accepted ADR-010 requirement for a separate key and least-privilege boundary is unchanged: this position does not amend it, and the reviewer decides whether it is required before real-candidate use. |
| 4 | Signatures, attestations, CAPTCHA, and MFA are never automated; the user completes them manually. | Matches the implemented policy (direct candidate action). Counsel confirms. |
| 5 | The record must show who submitted: when the platform's adapter did not submit, the candidate did. | Attempts already carry the adapter and version, and history separates adapter attempts from candidate takeover and candidate attestation (`taken_over`, `user_attested_submitted`). Whether an explicit submitter field is needed is an engineering follow-up under D3-008; reviewers assess the evidence kinds. |
| 6 | The engineering defaults below are accepted. | Product owner acknowledgement recorded; reviewers may still add conditions. |

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
| Job-specific resume: deterministic selection and ordering of the candidate's own bullets (never adds or rewords text), verified DOCX/PDF, content hash bound into the packet, computed in the Documents runtime so the Gateway never reads resume text ([ADR-031](../adr/031-deterministic-resume-tailoring-in-documents-runtime.md), proposed) | Documents runtime, Applications, Gateway, web | Unit, PostgreSQL, and HTTP end-to-end tests; deployed to development and answering the fixed request (no resume can be tailored yet because document processing is dark) |
| After approval, an Apply step that opens the employer's page and offers the approved answers and the verified tailored resume; it never submits and makes no attempt call | Web | Unit tests and a real-Chromium run against a mocked API |
| Automatic fills only from exactly one confirmed, type-fitting fact under an owner-approved 26-row convention; restricted answers never mapped | Applications packet source | 13 tests |

## What is not implemented or not proven

- No real model, provider, or data-processing agreement exists; real-model factuality and
  injection resistance are unmeasured.
- No provider adapter exists (D3-013 fixtures are missing); no live form, submission, or
  confirmation detection has been exercised.
- The answer vault has no persistence, separate key, or API (blocked by D3-015 and D3-R4).
- Applications candidate export, deletion, and restore replay are implemented and locally verified (D3-014). The owner confirmed the `d3-development-synthetic-v1` policy selection on 2026-09-19, but it is not activated: activation needs a Gateway release, which is blocked by D3-020. The Applications schema itself is deployed to development (D3-015).
- No extension integration exists. The Auth0 `applications:*` scopes, Gateway routes, BFF routes, and review workspace exist in development and were exercised with a real sign-in (create and packet prepare returned 201); nothing was approved or submitted.
- No durable workflow, outbox publisher, or alarm exists for Applications.
- Accessibility was checked by automated jsdom axe rules and a real-Chromium keyboard run of the real
  components against a mocked API (no color contrast, no assistive technology, no live end-to-end run).

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
