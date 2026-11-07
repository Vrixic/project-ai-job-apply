# D3.2 - Live AI Generation

- Status: Ready (not started)
- Start: Not started
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-10-26
- Master tracker: [Delivery tracker](DELIVERY_TRACKER.md)

## Objective

Turn on live AI generation, which is the product's main feature: grounded resume tailoring and
cover letters written by a model from the candidate's own saved Profile and the exact job, shown for
review, and used only after the candidate approves and applies. D3 built and locally tested every
layer around the model (gated adapter, grounded output validation, factuality checks, disclosure,
single-dispatch admission, provider response lifecycle, disposal) and closes with live AI off,
using deterministic tailoring. This phase supplies the one thing that was missing: a model provider
and account that meets the retention rule, and the live journey on top of it.

## Why this is a separate phase

[ADR-038](../../adr/038-one-off-generated-application-materials.md) requires that no generated content is persisted
and that every copy, including the provider's, expires within 30 minutes. The owner confirmed on
2026-10-26 that no provider or account policy available today meets that limit, so live AI could
not be part of closing D3. Owner decision 2026-10-26: D3 closes with live AI off, and everything AI
related is tracked here so it is handled next and is not lost.

## Task register

| ID | Task | Status | Owner | Depends on | Notes |
|---|---|---|---|---|---|
| D3.2-001 | Choose the model provider and account arrangement that meets ADR-038 (no training, no persistence, every copy gone within 30 minutes) and record it as an ADR. | Ready | Product owner; Claude | None | Owner decision. Candidate: Amazon Bedrock in the development and production AWS accounts, so no prompt or response leaves the account and no new subprocessor appears; the alternative is a zero-retention agreement with a direct provider. Bedrock needs the account-level model-invocation logging to stay off. |
| D3.2-002 | Wire the chosen provider behind the existing model gateway: model access, least-privilege role, private egress or endpoint, kill switch default off, cost ceiling. | Ready | Claude | D3.2-001 | Reuses the gated adapter (D3-004, D3-037, D3-038). Infrastructure changes follow the guarded release path. |
| D3.2-003 | Live grounded resume tailoring: generation from saved Profile records and the exact job, factuality checks, honest failure and retry states. | Ready | Claude | D3.2-002 | Deterministic tailoring stays as the fallback. |
| D3.2-004 | Live cover letters: composition, single dispatch, positive settlement, temporary-copy cleanup and candidate preview. | Ready | Claude | D3.2-002 | Carries D3-017, D3-042 to D3-050, D3-057 to D3-067. |
| D3.2-005 | Prove the 30-minute all-copy expiry across provider, browser, ATS and every temporary copy with live traffic, and that no generated content persists. | Ready | Claude | D3.2-003 | Carries D3-064 and D3-072. Security criterion; it stays. |
| D3.2-006 | Connected journey with live AI on: generate, review, approve, Apply, confirmed-submission history, through the deployed web app and installed extension. | Ready | Claude; owner | D3.2-003, D3.2-004 | Carries the live candidate-output quality check the owner chooses to do. |
| D3.2-007 | Ashby live submission proof: fill, attach and submit once on a posting the owner picks, after the candidate's approval. | Ready | Claude; owner | None | Carried from D3 (owner decision 2026-10-26: Greenhouse is the D3 proof). The adapter is built and tested on synthetic pages (ADR-053). |
| D3.2-008 | Security review of the provider data path, folded into the independent assessment D6-015. | Ready | Independent assessor | D3.2-005 | Not a gate for building; a gate for public launch. |
| D3.2-009 | Narrative answers in the browser ([ADR-057](../../adr/057-narrative-answers-drafted-in-the-candidates-browser.md)): Gateway route and model call (built, dark), extension icon on free-text questions, key secret and kill switch in Terraform, live test on the owner's account. | In progress | Claude; owner | None | Owner chose OpenAI `gpt-6-luna`, the Terms of Service as consent, and the icon even when the employer asks for no AI (2026-11-07). The owner puts the OpenAI key in the secret and sets a spending cap on the OpenAI project. A durable plan-driven quota is a launch prerequisite. |

## Exit criteria

- [ ] An accountable decision record names the provider and account arrangement and states how it meets ADR-038.
- [ ] A candidate can generate a tailored resume and a cover letter with live AI, review them, approve and apply, and see the confirmed submission in history.
- [ ] No generated content persists, and every copy including the provider's expires within 30 minutes, with evidence from live traffic.
- [ ] The kill switch turns live AI off without a release, and the deterministic fallback keeps working.
- [ ] The Ashby live submission proof is done.

## Decisions and scope changes

2026-10-26: Created from the owner's decision to close D3 with live AI off and to carry all AI
related work to a later phase. The owner stressed that live AI generation is the main feature of the
product, so this phase is the next one to schedule. AI-evaluation and accessibility acceptance stay
removed (owner decision 2026-10-21); security criteria remain.

2026-11-07: The owner asked for an icon on free-text employer questions that drafts an answer from the
candidate's Profile, chose OpenAI GPT for it, set up for scalability and price, and chose the Terms of
Service as consent ([ADR-057](../../adr/057-narrative-answers-drafted-in-the-candidates-browser.md)). This
is D3.2-009. It uses the development-scope OpenAI decision of 2026-10-02 and does not settle D3.2-001 for
cover letters and resumes, which keep the ADR-038 30-minute rule.

## Risks and blockers

| ID | Risk | Status |
|---|---|---|
| D3.2-R1 | No provider or account the owner has meets the ADR-038 retention limit; the arrangement may need a commercial agreement or a different cloud provider path. | Open |
| D3.2-R2 | Model output may state something the candidate did not claim; grounded validation and review reduce this and the candidate approves every packet. | Open |
| D3.2-R3 | Per-request cost can exceed the Free-tier economics. | Open |
