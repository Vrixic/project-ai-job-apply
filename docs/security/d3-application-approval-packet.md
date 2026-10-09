# D3-012 Application Preparation and Submission Approval Packet

- Status: Engineering packet refreshed for accountable review; D3 remains in progress. This is
  not an approval or legal advice. Read alongside the recorded, limited
  [development owner disposition](d3-012-accountable-disposition.md); no independent approval is claimed.
- Task: D3-012. Release gates: LR-D3-01 (application preparation) and LR-D3-02 (application
  submission) in the [legal review register](../product/foundation/legal-review-register.md).
- Prepared: 2026-09-18. Owner positions recorded 2026-09-19. Engineering inventory refreshed
  2026-10-09 against merged source `d7a8a85b` and the linked delivery evidence.
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

## Current engineering inventory (2026-10-09)

Local tests use synthetic candidates and simulated external transports unless the linked evidence
explicitly records managed or human acceptance. Historical SQL/managed evidence is dated; it is
not a fresh live run of the current connected journey. Current verification and runtime shutdown:
[October 9 evidence](../product/delivery/evidence/d3-connected-candidate-journey-2026-10-09.md).

| Control | Where | Evidence |
|---|---|---|
| Restricted answers always shown; never-infer answers require candidate entry or an explicitly selected/meaning-confirmed saved version; attestations/signatures/challenges require direct action | [Applications field policy](../../backend/services/applications/src/field-policy.ts) | Source/unit tests; saved-answer reuse remains off pending UI and release acceptance |
| Immutable packet with content hash; approval binds job/form/artifact state and expires at the earlier of the 24-hour cap or original temporary-material deadline; changes invalidate approval | Applications packet and store | Unit/SQL evidence; [temporary packet binding](../product/delivery/evidence/d3-temporary-packet-binding-2026-10-05.md) |
| Write-ahead dispatch; ambiguous results block another submission until reconciled; database-level one-attempt-per-packet guard; crash recovery | Applications attempts and migration `0001` | Integration tests (race of 8, crash recovery) |
| Technical history ends at `applied`; no hiring-outcome vocabulary in code, schema, API, or events | Applications, OpenAPI, events | Contract and parity tests |
| Owner-scoped reads/writes; 404 for foreign ids; restricted packet values protected under separate key purposes with keyed replay, rather than ordinary packet/receipt plaintext | [Applications](../../backend/services/applications/README.md), [restricted cipher](../../backend/services/applications/src/restricted-packet-kms-cipher.ts) | Local protection/SQL evidence and [managed archival of seven legacy receipts](../product/delivery/evidence/d3-legacy-receipt-transition-2026-10-08.md); broader activation/replay acceptance remains |
| AI gateway/provider remain default-off; fresh disclosure, confirmed non-restricted evidence, grounded output and mandatory review; original-work identity/settlement/disposal controls | [AI SDK](../../packages/ai-sdk/README.md), accepted [ADR-030](../adr/030-ai-gateway-and-grounded-generation.md) | Offline adversarial/lifecycle tests; no live provider, account-retention or real-model quality acceptance |
| Adapter kill switch, approved effects and exact unexpired QA-accepted provider-derived fixtures; conflicting mappings and duplicate options refuse; restricted fields/challenges produce no fill/attach actions | [ATS SDK](../../packages/ats-sdk/README.md) | All 20 synthetic SDK tests pass; synthetic evidence cannot establish provider fidelity |
| Assisted-manual fallback: no page action, no automated submission | ATS SDK | Tests |
| Review resets for each packet; restricted booleans preserve explicit false; exact generated preview plus fresh acknowledgement required; explicit cover-letter opt-in, stable admission retries, bounded status checks and cancellation | [Web](../../frontend/web/README.md) | D3-080/081 regressions and actual Chromium synthetic keyboard/axe journey; cover-letter UI flag remains off |
| Privacy-safe versioned measurement | Applications metrics | Tests proving no value or identifier is emitted |
| Job-specific resume deterministically reorders/trims the candidate's own bullets, with hash binding and PDF/DOCX rendering; generated content belongs in the original memory-only native process | Accepted [ADR-031](../adr/031-deterministic-resume-tailoring-in-documents-runtime.md), [ADR-038](../adr/038-one-off-generated-application-materials.md), Documents/native runtime | Local rendering/process/transport evidence; direct browser-native generation/preview/download acceptance remains |
| Manual Apply opens the canonical employer page, exposes approved answers and starts a candidate-owned `taken_over` attempt; reconciliation distinguishes candidate attestation from provider confirmation and refreshes terminal history | Web and Applications | Existing development manual acceptance is preserved; October 9 connected browser checks use synthetic BFF/native responses and make no external submission |
| Automatic proposals only from exactly one confirmed, type-fitting fact; restricted answers never inferred | Applications packet source | Fact-source regressions; selected saved answers use the separate explicit-selection path |
| Separate encrypted answer vault, metadata-only public listing and exact-version private reads; correction/deletion/quarantine/expiry checks and metadata locks at admission | [Profile vault](../../backend/services/profile/src/restricted-answer-vault.ts), [saved-answer packet binding](../product/delivery/evidence/d3-vault-packet-binding-2026-10-04.md) | Local source/SQL/restore evidence; no public plaintext read; observed-form candidate selection and connected reuse remain unfinished |
| Identifier-only preparation workflow/starter/recovery plus native activity; generated bodies excluded from durable state, packets, queues and ordinary Gateway content routes | [Workflows](../../backend/workflows/README.md), [native preparation evidence](../product/delivery/evidence/d3-native-application-preparation-release-2026-10-07.md) | Local isolation/replay tests and dormant managed resource evidence; complete activation/drain/cleanup acceptance remains |

## Remaining source work and external gates

- The named development provider selection does not prove account access, exact contract/entity/
  region/disclosure approval, real-model factuality/injection resistance, or compliant retention.
  ADR-038 requires no candidate prompts/generated content retained beyond 30 minutes, including
  diagnostic/abuse/cache copies. The earlier development amendment explicitly records longer
  possible provider retention; `store:false`, cancellation or response deletion cannot close this gate.
- No provider adapter exists (D3-013 fixtures are missing); no live form, submission, or
  confirmation detection has been exercised.
- Saved-answer storage/backend reuse exists; observed-form selection/review UI, compatible
  current release and connected correction/expiry/reuse acceptance remain. Do not infer context
  or question hashes from a job description or silently select the newest answer version.
- Direct browser-native identity/content transport and cover-letter preview/download UI remain
  unfinished. The web session's server-held token cannot be returned to the browser or replaced
  by a serverless generated-content proxy. The owner choice between separate in-memory browser
  PKCE and extension-mediated access is pending. Native HTTPS/CORS and exact-owner acceptance remain.
- The extension application executor/handoff is unfinished. No accepted form/confirmation
  adapter exists, and no installed-extension application submission is claimed.
- Candidate export/deletion/restore and native withdrawal have local and partial managed evidence;
  fresh current-release document-inclusive rights/restore, backup aging, original-writer drain,
  all-copy disposal and accountable review remain. Use the [current phase register](../product/delivery/phase-3-application-preparation.md)
  and [managed release record](../product/delivery/evidence/d3-native-application-disposal-2026-10-07.md)
  for exact dated scope; test infrastructure is dormant, not a live accepted release.
- Accessibility was checked by automated jsdom axe rules and a real-Chromium keyboard run of the real
  components against a mocked API, including the manual attempt and candidate attestation transition
  (no assistive technology or live end-to-end run).

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
2. The planned extension executor would report results from the candidate's own browser. Is candidate-reported
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

This dated delta records the withdrawal implementation; the engineering inventory above was
refreshed on October 9. [The D3 phase record](../product/delivery/phase-3-application-preparation.md)
owns current implementation/release/acceptance state. This is not an accountable approval.

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
