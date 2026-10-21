# D3-012 Application Preparation and Submission Approval Packet

- Status: Engineering packet refreshed for accountable review; D3 remains in progress. This is
  not an approval or legal advice. Read alongside the recorded, limited
  [development owner disposition](d3-012-accountable-disposition.md); no independent approval is claimed.
- Task: D3-012. Release gates: LR-D3-01 (application preparation) and LR-D3-02 (application
  submission) in the [legal review register](../product/foundation/legal-review-register.md).
- Prepared: 2026-09-18. Owner positions recorded 2026-09-19. Engineering inventory refreshed
  2026-10-14 against merged repository source `7fa98b29` and the dated release evidence below.
  Repository, candidate-host and managed-runtime sources are distinct; this refresh grants no activation.
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
| 1 | AI processing is acceptable in principle and users will be told: candidate facts and job text may reach a model provider, with disclosure to the user. | The October 2 development amendment selects OpenAI `gpt-6-luna`; the October 3 amendment permits source-only lifecycle work. Neither establishes the no-retention requirement subsequently adopted in ADR-038 or activates live generation. |
| 2 | Filling fields on Greenhouse, Lever, and Ashby application pages is a given product requirement. | Exact variants still need source review and accepted D3-013 fixtures. The October 2 scope decision makes Greenhouse the first adapter; Lever/Ashby follow later. |
| 3 | Sensitive answers are kept, and the owner does not expect any stored answer to be highly sensitive. | Restricted answers are still shown for review and never inferred. The accepted ADR-010 requirement for a separate key and least-privilege boundary is unchanged: this position does not amend it, and the reviewer decides whether it is required before real-candidate use. |
| 4 | Signatures, attestations, CAPTCHA, and MFA are never automated; the user completes them manually. | Matches the implemented policy (direct candidate action). Counsel confirms. |
| 5 | The record must show who submitted: when the platform's adapter did not submit, the candidate did. | Attempts already carry the adapter and version, and history separates adapter attempts from candidate takeover and candidate attestation (`taken_over`, `user_attested_submitted`). Whether an explicit submitter field is needed is an engineering follow-up under D3-008; reviewers assess the evidence kinds. |
| 6 | The engineering defaults below are accepted. | Product owner acknowledgement recorded; reviewers may still add conditions. |

## Current engineering inventory (2026-10-14)

Local tests use synthetic candidates and simulated external transports unless the linked evidence
explicitly records managed or human acceptance. Historical SQL/managed evidence is dated; it is
not a fresh live run of the current connected journey. The
[October 13 checkpoint](../product/delivery/evidence/d3-vault-native-rights-verification-2026-10-13.md)
records candidate source `55f8b7bc`, Gateway 114 and native artifact `e72f5535`: synthetic search,
preparation, separate in-memory sign-in, exact preview/review, approval and PDF/DOCX downloads pass.
The [October 14 rights evidence](../product/delivery/evidence/d3-rights-readiness-2026-10-14.md)
records Gateway 117/source `a45c456c`, Profile activity 25/source `cc464385`, recovered deletion and
verified shutdown. Neither checkpoint establishes live AI, installed-extension or ATS acceptance.

| Control | Where | Evidence |
|---|---|---|
| Restricted answers always shown; never-infer answers require candidate entry or an explicitly selected/meaning-confirmed saved version; attestations/signatures/challenges require direct action | [Applications field policy](../../backend/services/applications/src/field-policy.ts) | Source/unit/SQL tests; D3-087 supplies locally verified selection/review; reuse remains off pending release and live acceptance |
| Immutable packet with content hash; approval binds job/form/artifact state and expires at the earlier of the 24-hour cap or original temporary-material deadline; changes invalidate approval | Applications packet and store | Unit/SQL evidence; [temporary packet binding](../product/delivery/evidence/d3-temporary-packet-binding-2026-10-05.md) |
| Write-ahead dispatch; ambiguous results block another submission until reconciled; database-level one-attempt-per-packet guard; crash recovery | Applications attempts and migration `0001` | Integration tests (race of 8, crash recovery) |
| Technical history ends at `applied`; no hiring-outcome vocabulary in code, schema, API, or events | Applications, OpenAPI, events | Contract and parity tests |
| Owner-scoped reads/writes; 404 for foreign ids; restricted packet values protected under separate key purposes with keyed replay, rather than ordinary packet/receipt plaintext | [Applications](../../backend/services/applications/README.md), [restricted cipher](../../backend/services/applications/src/restricted-packet-kms-cipher.ts) | Local protection/SQL evidence and [managed archival of seven legacy receipts](../product/delivery/evidence/d3-legacy-receipt-transition-2026-10-08.md); broader activation/replay acceptance remains |
| AI gateway/provider remain default-off; fresh disclosure, confirmed non-restricted evidence, grounded output and mandatory review; original-work identity/settlement/disposal controls | [AI SDK](../../packages/ai-sdk/README.md), accepted [ADR-030](../adr/030-ai-gateway-and-grounded-generation.md) | Offline adversarial/lifecycle tests; no live provider, account-retention or real-model quality acceptance |
| Adapter kill switch, approved effects and exact unexpired QA-accepted provider-derived fixtures; conflicting mappings and duplicate options refuse; restricted fields/challenges produce no fill/attach actions | [ATS SDK](../../packages/ats-sdk/README.md) | All 20 synthetic SDK tests pass; synthetic evidence cannot establish provider fidelity |
| Assisted-manual fallback: no page action, no automated submission | ATS SDK | Tests |
| Review resets for each packet; restricted booleans preserve explicit false; exact generated preview plus fresh acknowledgement required; explicit cover-letter opt-in, stable admission retries, bounded status checks and cancellation | [Web](../../frontend/web/README.md) | D3-080/081 regressions and actual Chromium synthetic keyboard/axe journey; cover-letter UI flag remains off |
| Privacy-safe versioned measurement | Applications metrics | Tests proving no value or identifier is emitted |
| Job-specific resume deterministically reorders/trims the candidate's own bullets, with hash binding and PDF/DOCX rendering; generated content belongs in the original memory-only native process | Accepted [ADR-031](../adr/031-deterministic-resume-tailoring-in-documents-runtime.md), [ADR-038](../adr/038-one-off-generated-application-materials.md), Documents/native runtime | October 13 managed synthetic generation/preview/approval/direct downloads and PDF appearance inspection pass; accountable output quality and all-copy expiry acceptance remain |
| Manual Apply opens the canonical employer page, exposes approved answers and starts a candidate-owned `taken_over` attempt; reconciliation distinguishes candidate attestation from provider confirmation and refreshes terminal history | Web and Applications | October 13 managed synthetic manual Apply truthfully records `NOT_SUBMITTED`; Applied history has no confirmed applications. No employer submission occurred; positive confirmation/history remains unverified |
| Automatic proposals only from exactly one confirmed, type-fitting fact; restricted answers never inferred | Applications packet source | Fact-source regressions; selected saved answers use the separate explicit-selection path |
| Separate encrypted answer vault, metadata-only public listing and exact-version private reads; correction/deletion/quarantine/expiry checks and metadata locks at admission | [Profile vault](../../backend/services/profile/src/restricted-answer-vault.ts), [saved-answer packet binding](../product/delivery/evidence/d3-vault-packet-binding-2026-10-04.md) | Local source/SQL/restore evidence; no public plaintext read; D3-087 observed-form selection/review and fresh manual-form confirmation pass local SQL/browser checks; live connected reuse remains unfinished |
| Identifier-only preparation workflow/starter/recovery plus native activity; generated bodies excluded from durable state, packets, queues and ordinary Gateway content routes | [Workflows](../../backend/workflows/README.md), [native preparation evidence](../product/delivery/evidence/d3-native-application-preparation-release-2026-10-07.md) | Local isolation/replay tests and dormant managed resource evidence; complete activation/drain/cleanup acceptance remains |

## Remaining source work and external gates

- The named development provider selection does not prove account access, exact contract/entity/
  region/disclosure approval, real-model factuality/injection resistance, or compliant retention.
  ADR-038 requires no candidate prompts/generated content retained beyond 30 minutes, including
  diagnostic/abuse/cache copies. The earlier development amendment explicitly records longer
  possible provider retention; `store:false`, cancellation or response deletion cannot close this gate.
  On October 10 the owner confirmed that no qualifying provider/account policy exists. Live AI
  cover-letter testing remains externally blocked and disabled; independent native resume work continues.
- The default-off Greenhouse execution bridge is implemented and locally verified, including
  approved attachment, one-shot dispatch and result handling ([D3-101 evidence](../product/delivery/evidence/d3-greenhouse-bridge-implementation-2026-10-10.md)).
  Accepted provider-derived D3-013 fixtures and exact-variant source-policy/QA approval remain
  missing; no live form, submission or confirmation detection is claimed.
- Saved-answer storage/backend reuse and D3-087 observed-form selection/review source exist;
  compatible current release and live correction/expiry/reuse acceptance remain. Do not infer context
  or question hashes from a job description or silently select the newest answer version.
- Superseded 2026-10-20 by [ADR-050](../adr/050-generate-then-apply-flow.md): the separate Auth0 popup PKCE client of [ADR-044](../adr/044-browser-native-material-identity.md) is replaced by an authenticated BFF read. The October 13 popup evidence is historical. No confidential web token is returned, but generated bytes now cross BFF function memory (bounded, no-store, unlogged); that is a privacy-review item.
- D3-086 manual extension handoff and D3-087 explicit question capture are locally verified and
  default off. D3-101 implements the bounded automated execution path; provider fidelity,
  installed-extension operation and live submission acceptance remain unverified.
- Candidate export and vault CRUD have October 13 managed synthetic evidence. On October 14, one
  reviewed continuation recovered the original confirmed deletion: all eight owners complete,
  saved document/export versions absent, the original completed marker/retention preserved, and
  three failure notices archived and individually acknowledged. The original canonical 17-step
  run remains FAILED without a success receipt; full export/grant-expiry and rights acceptance
  remain open. No Execute retry or new deletion request is authorized by that recovery. Original-writer
  drain, all-copy material disposal and the live ambiguous-cancellation UI retest remain separate.
  Formal database recovery-proof gates were removed by the owner; encrypted backups, exact targets
  and completed-deletion safeguards remain. The October 14 evidence records dormant development,
  credential rotation and preserved encrypted historical copies; it does not establish a future
  restore or historical-copy erasure. Use the [current phase register](../product/delivery/phase-3-application-preparation.md)
  for exact dated scope and remaining gates.
- Generated-content account cleanup still lacks a production quiescence proof implementation.
  The [private proof contract](../../backend/workflows/src/candidate-rights-aws.ts) requires positive
  evidence bound to every original writer/provider execution; the
  [production composition](../../backend/workflows/src/profile-readiness-lambda.ts) supplies no such
  port and generation cleanup fails closed. This is unfinished engineering, separate from the
  recovered ordinary-resume deletion. Implementing owner fences/drain and reviewed runtime/IAM
  composition remains agent work; elapsed time, local cancellation or a test-only true port is no proof.
- Accessibility was checked by automated jsdom axe rules and a real-Chromium keyboard run of the real
  components against a mocked API, including the manual attempt and candidate attestation transition
  (no assistive technology or live end-to-end run).

## Remaining work and its owners

| Work | Agent execution | Required external input or human decision |
|---|---|---|
| Engineering review packet | Refresh source/evidence inventory and prepare review materials; this refresh completes that documentation work | Accountable reviewers decide the dispositions; an engineering refresh supplies no approval |
| Full rights/expiry acceptance | Prepare fresh runtime/plans, run the maintained tests, fix demonstrated failures, collect receipts and shut down | A new disposable synthetic account, fresh candidate MFA and explicit exact-account deletion confirmation; never reuse the recovered request's confirmation |
| Live vault/reuse and cancellation retests | Exercise the current managed routes and UI, fix demonstrated failures and record bounded results | A controlled synthetic account and fresh authentication; deletion confirmation applies only if that account enters the rights deletion test |
| Installed-extension handoff, answer correction/withdrawal/reuse/expiry | Exercise the installed extension and fix demonstrated failures | Connected Chrome/Edge with the exact installed extension and grants; an in-app browser does not supply this evidence |
| Live AI/cover-letter integration and cleanup | Configure the approved provider, test grounded output, recovery and every platform/provider copy's expiry | Qualifying provider/account terms and accountable processing/disclosure authority under ADR-038; live AI remains off |
| Production generation-cleanup quiescence | Implement and test the original-writer fence/drain proof and compose its private runtime/IAM boundary | Positive evidence from the reviewed writer/provider controls before live activation; the missing port continues to deny cleanup |
| Greenhouse integration and confirmed submission/history | Integrate accepted variants and test attachment/fill, one-shot submission, confirmation, duplicates, ambiguity and takeover | Authorized QA destinations, accepted provider-derived fixtures and exact-variant capability authority; capture/sanitization/representativeness decisions follow D3-013 |
| Quality, accessibility and capability acceptance | Supply automated checks, scoped fixes and evidence for the actual connected journey | Accountable product/output-quality, accessibility and legal/security/privacy review; simulated checks cannot substitute for those decisions |

No additional standalone extension/ATS implementation gap is established by the current evidence.
Prerequisite-blocked test execution remains agent work after access and authority exist. Independent
D1/admin acceptance stays deferred. No paid runtime should be started merely to wait for these inputs.

## Owner-accepted defaults and current material policy

- Approval lifetime capped at 24 hours and additionally at the original generated-material
  deadline; auto-review confidence threshold 0.90. ADR-038's 30-minute material lifetime is
  absolute from generation completion and is never renewed by edits, reads, retries or approval.
- One live application per candidate and job; cancellation is impossible once a submission is in
  flight.
- A candidate-attested "not submitted" reconciliation requires an explicit duplicate-risk
  acknowledgement; `user_attested` confirmation is its own evidence kind.
- Approval evidence is the Applications approval record; no separate Profile consent ledger.
- Fact confidence by provenance (typed 1.00, resume with spans 0.95, without 0.90, derived 0.85).
- AI disclosure approval lifetime 15 minutes.

## Threats and questions for the security/privacy reviewer

1. Does the implemented separate-key vault/packet/replay boundary, effective IAM, just-in-time
   owner reads and rights/restore behavior satisfy ADR-010 for the exact reviewed release?
   Local encryption tests or legacy receipt archival alone do not prove that complete boundary.
2. The implemented extension executor reports results from the candidate's own browser. Is candidate-reported
   confirmation acceptable as evidence, given it is treated as candidate-observed, not provider truth?
3. Generated text reaches an employer under the candidate's name. What disclosure and review UX
   satisfies the AI-disclosure requirement?
4. What retention applies to packets, attempts, and history after `applied`, and how do export,
   deletion, and restore reconcile with append-only records?
5. Does the proposed on-demand active-tab form reading for the assisted-manual fallback fit the
   extension permission and store-review posture (LR-D2-02)?
6. Does the complete native browser/ATS path enforce original completion plus 30 minutes,
   no content persistence, owner-bound access and earlier logout/cancellation/submission disposal?
   Candidate-held downloads/employer copies are outside platform deletion authority and must be disclosed.
7. Which provider account terms and independently verified settings prove ADR-038 retention for
   all provider copies? A local timeout, abort or exact response deletion is not that proof.

## Requested record per decision

Reviewer name and accountable role, scope and artifact commit reviewed, jurisdiction and source-policy
versions, permitted and prohibited behaviors, conditions with owners and closure evidence, revalidation
trigger, and the product owner's acknowledgement of conditions, as required by the legal review register.


## Engineering delta: owner material withdrawal (2026-10-08)

This dated delta records the withdrawal implementation; use the current engineering inventory above
and [the D3 phase record](../product/delivery/phase-3-application-preparation.md) for later verification.
The phase record owns current implementation/release/acceptance state. This is not an accountable approval.

The new `PUT /v1/material-withdrawals/{requestId}` derives the candidate from authenticated
`applications:write` context; `GET` requires `applications:read`. The UUIDv7 path is the replay key.
Neither route accepts an owner, task identifier, body or query. Withdrawal and its leased cleanup
queue commit together in Applications. Both tables contain internal identifiers/timing/control
metadata only, are omitted from portable candidate content, and are deleted by the authorized
candidate-deletion function. Foreign reads return 404; operational failures use fixed problem text.

A private IAM-invoked numeric worker accepts only a versioned drain action, reads the original
receipt, and attempts exact allowlisted native task retirement without generation/body-read
capabilities. Queue leases fence stale completions. Accepted cleanup can continue after sign-out
or quarantine; that authority grants no new candidate read or preparation. Task settlement is not
provider retention, route deletion or all-copy disposal. Older requests cannot seal newer native
generations. Application revision/submission status and ambiguous-attempt evidence are unchanged.

The endpoint and worker are default-off. Worker artifact/schedule/IAM and managed disposal
acceptance remain release gates. The source web logout hook also defaults off; enabling it
requires managed withdrawal acceptance. A termination request is not observed task death,
positive provider settlement or proof of all-copy removal.


## Engineering delta: withdrawn-answer recovery (2026-10-09)

[ADR-047](../adr/047-withdrawn-answer-application-recovery.md) adds a metadata-only candidate
projection after exact selected-reference admission positively establishes withdrawal or expiry.
No packet, approval, ordinary/private answer, hash or material reference is returned. Operational
failures are still unavailable; export keeps its separate rights-authorized original-value path.
Existing status/revision/attempt evidence supports recovery and explicit reconciliation. Fresh
preparation drops remembered entries and requires new review/approval. Existing attempt fences,
duplicate-risk acknowledgement and original generated-material expiry remain authoritative.
This is engineering scope, not privacy/security approval or live activation evidence.

## Engineering delta: generate-then-apply flow (2026-10-20)

[ADR-050](../adr/050-generate-then-apply-flow.md) is owner-directed and locally verified; it is not
privacy/security approval or live evidence.

- **Material reads.** The popup sign-in is removed. A same-origin BFF route reads the scalar
  location proof with the candidate's server-held token, validates the UUID allocation under the
  configured base host on port 8443, reads once (no cookies, redirects or referrer; 15 seconds;
  512 KiB), verifies the closed schema, material identity, content hash and packet hash, and
  re-reads the proof. The native process still authorizes every read (exact issuer, audience, scope,
  expiry and owner) and fails closed. The 30-minute expiry, owner binding and purge are unchanged.
  Residual: generated bytes transit web function memory.
- **Approval invariant.** The server-enforced packet/approval hash binding, 24-hour and 30-minute
  expiries, stale-binding refusal and attempt guards are unchanged. Only the user ceremony is
  removed: Apply approves the exact packet shown. Empty direct-action answers and sensitive,
  restricted or uncertain answers still require explicit entry or per-answer checks first. The
  `documents.resume` acknowledgement is given by Apply only while the resume identity is shown (and,
  for a generated resume, after its exact preview was displayed). Inventory rows for the approve,
  review-acknowledgement and cancel controls describe the earlier UI.
- **Resume bytes.** Generated resumes are PDF only. The uploaded-resume fallback adds an
  owner-scoped, exact-version original read through the Documents processor (default off,
  `UPLOADED_RESUME_ATTACHMENT_ENABLED`), 2 MiB cap, never cached, SHA-256 bound to the packet.
- **Extension.** An identifiers-only apply intent arms the popup; the candidate confirms on the
  employer tab. An expired or mismatched generated file is never attached.
- **Submission.** The stated rule is that the extension never clicks the final submit. The dark
  Greenhouse path of ADR-049 still clicks it when no challenge is present; this is an open owner
  decision.
