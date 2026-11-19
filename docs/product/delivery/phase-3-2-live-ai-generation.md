# D3.2 - Live AI Generation

- Status: In progress
- Start: 2026-11-13
- Completion: Not completed
- Owners: Unassigned
- Last updated: 2026-11-13
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
| D3.2-001 | Choose the model provider and account arrangement that meets ADR-038 (no training, no persistence, every copy gone within 30 minutes) and record it as an ADR. | Complete | Product owner; Claude | None | [ADR-059](../../adr/059-live-generation-through-amazon-bedrock.md), 2026-11-13: Amazon Bedrock in our own account, Converse API, `us.` inference profiles, interim model Claude Sonnet 4.6 as configuration, invocation logging kept off. The ADR records the residual risk that Sonnet 4.6 is not named on the AWS retention pages (an inference from AWS documentation). `gpt-6-luna` is not available to the account and needs AWS enablement plus zero data retention. |
| D3.2-002 | Wire the chosen provider behind the existing model gateway: model access, least-privilege role, private egress or endpoint, kill switch default off, cost ceiling. | In progress | Claude | D3.2-001 | Reuses the gated adapter (D3-004, D3-037, D3-038). Infrastructure changes follow the guarded release path. Plan (ADR-059): Terraform for the invoke permission scoped to the profile and its foundation models and attached only while the switch is on, the switch (default off), a $20 a month Budgets ceiling with alarms at 50% and 80%, the boundary statement and private egress; then the Bedrock `ModelProvider` adapter. Progress 2026-11-13: the reviewed model list (`infrastructure/terraform/live-generation-models.json`, with a guard test) and the bootstrap boundary ceiling (one `bedrock:InvokeModel` statement bound to the native resume task roles and the one profile, off unless `live_generation_model` is set; Gateway and cleanup stop statements merged per cluster to make room) are built and tested. Also built and tested (dark, off by default): the task role grant that exists only while the `live_generation.enabled` kill switch is on, the `bedrock-runtime` endpoint with an exact policy, the $20 a month budget (alerts at 50% and 80%), the hourly burst alarm and `scripts/verify-bedrock-invocation-logging-off.ps1` (run against development 2026-11-13: logging off). The Bedrock `ModelProvider` is built and tested (`packages/ai-sdk/src/bedrock.ts`: Converse with the output forced through one tool so the reply is schema-shaped JSON, no cache points, guardrails, trace, images or reasoning, a per-request token cap, strict reply reading, provider text never surfaced) with its native transport (`backend/services/documents/src/native-bedrock-converse.ts`: one attempt, fixed regional endpoint, task credentials, silent logger; `@aws-sdk/client-bedrock-runtime` 3.1133.0). It is not yet composed into any task image. Found 2026-11-13: Anthropic models in this account now answer "Model use case details have not been submitted" (the Anthropic first-time use case form is not on file; Llama still answers), so the owner must submit it before any live Sonnet 4.6 call. Still to do at the live sitting: apply bootstrap and the environment, confirm the Cost Explorer service name for the budget, drill the switch. |
| D3.2-003 | Live grounded resume tailoring: generation from saved Profile records and the exact job, factuality checks, honest failure and retry states. | In progress | Claude | D3.2-002 | Deterministic tailoring stays as the fallback. Built and tested 2026-11-13 (dark, not released): selection-only tailoring ([ADR-059](../../adr/059-live-generation-through-amazon-bedrock.md) addendum): the model returns bullet ids per entry through a forced tool, never text; the same factuality gate and a 12 second timeout; deterministic fallback on any failure; the path is part of the content hash; image configuration `liveGeneration.modelId`; the resume image bundle gate keeps OpenAI out. Still to do: release a new native resume image and task revision, apply the environment and bootstrap, the live quality check with the owner (D3.2-006). |
| D3.2-004 | Live cover letters: composition, single dispatch, positive settlement, temporary-copy cleanup and candidate preview. | In progress | Claude | D3.2-002 | Carries D3-017, D3-042 to D3-050, D3-057 to D3-067. Built and tested 2026-11-13 (dark, not released): the cover-letter path moves to Bedrock ([ADR-059](../../adr/059-live-generation-through-amazon-bedrock.md) addendum 12 to 16): new notice `bedrock-cover-letter.v1` and the model bound to it, Applications migration `0016`, OpenAPI, export schema and generated clients, the native image composes the Bedrock provider on the task role with no provider key, and the build gate forbids OpenAI. Also built 2026-11-13 (addendum 16): a definite Bedrock refusal (the kill switch, a missing use case form, throttling) is a typed `ProviderRefusedError`, reported as a `not_dispatched` receipt so the claim settles and the candidate sees a failed state; unknown outcomes stay unsettled. Terraform built and tested 2026-11-13 (addendum 17, dark): the cover-letter task roles get the same switchable `bedrock:InvokeModel` grant, the endpoint and its security group admit them, the boundary ceiling names both role families (65 characters free) and the provider secret is gone from the release, platform access and role policy. The release and live-sitting plan is [the D3.2 sitting runbook](../../../infrastructure/runbooks/deployments/development-d3-2-live-generation-sitting.md). Still to do: a governed release of the native-material task and its Lambdas (none exists in development); the owner's wording review of the notice; the live run. |
| D3.2-005 | Prove the 30-minute all-copy expiry across provider, browser, ATS and every temporary copy with live traffic, and that no generated content persists. | Ready | Claude | D3.2-003 | Carries D3-064 and D3-072. Security criterion; it stays. |
| D3.2-006 | Connected journey with live AI on: generate, review, approve, Apply, confirmed-submission history, through the deployed web app and installed extension. | Ready | Claude; owner | D3.2-003, D3.2-004 | Carries the live candidate-output quality check the owner chooses to do. |
| D3.2-007 | Ashby live submission proof: fill, attach and submit once on a posting the owner picks, after the candidate's approval. | Ready | Claude; owner | None | Carried from D3 (owner decision 2026-10-26: Greenhouse is the D3 proof). The adapter is built and tested on synthetic pages (ADR-053). |
| D3.2-008 | Security review of the provider data path, folded into the independent assessment D6-015. | Ready | Independent assessor | D3.2-005 | Not a gate for building; a gate for public launch. |
| D3.2-009 | Narrative answers in the browser ([ADR-057](../../adr/057-narrative-answers-drafted-in-the-candidates-browser.md)): Gateway route and model call (built, dark), extension icon on free-text questions, key secret and kill switch in Terraform, live test on the owner's account. | In progress | Claude; owner | None | Owner chose OpenAI `gpt-6-luna`, the Terms of Service as consent, and the icon even when the employer asks for no AI (2026-11-07). The owner puts the OpenAI key in the secret and sets a spending cap on the OpenAI project. A durable plan-driven quota is a launch prerequisite. |
| D3.2-010 | Choice answers decided by Jev ([ADR-061](../../adr/061-choice-answers-decided-by-jev.md)), slice 1: contract, Jev client, Gateway route with the server-side context builder, thresholds and kill switch (dark). | In progress | Claude | D3.2-009 | Built and tested locally, dark, not released (2026-11-18): contract `POST /applications/{id}/choice-answers`, Jev client and context builder (`packages/ai-sdk/src/jev.ts`), Gateway composition with server-side classification, restricted statements and kill switch (`CHOICE_ANSWERS_ENABLED`). Release risk for D3.2-012: the Gateway Lambda environment is 3,915 of 4,096 bytes before the new variables, so the disposal list must be compacted first. |
| D3.2-011 | Jev choice answers, slice 2: the extension collects unresolved choice questions, fills above the thresholds with an "AI chose" list and Undo, and lists restricted proposals for the candidate to confirm one by one. | In progress | Claude | D3.2-010 | Built and tested locally (2026-11-18), dark until D3.2-012 releases the Gateway route. Ashby only; no programmatic Undo (the candidate changes a wrong answer on the page); the step runs before the fill. Verified in real Chrome on the live Mintlify page with every employer write blocked and the Gateway route stubbed: standard answer chosen, restricted answer proposed and chosen only after the candidate confirmed, declined proposal left unchosen, unavailable route left everything to the candidate. See ADR-061 implementation notes. |
| D3.2-012 | Jev choice answers, slice 3: Terraform (empty key secret, Gateway read, egress to the TypeSafe host, kill switch default off), Gateway release and live calibration of the thresholds at a restore sitting. | In progress | Claude; owner | D3.2-011 | Terraform built and validated locally (2026-11-18), not applied: secret container `.../choice-answers/typesafe-key`, Gateway read grant and secret endpoint-policy statement, `CHOICE_ANSWERS_ENABLED` kill switch (default off) and the key's ARN in the Gateway environment, output, operator allowlist entry. Gateway environment after the new variables, measured as compact JSON against the live function: 4,091 of 4,096 bytes with the list form of the disposal variable (5 free), 3,669 with the compact form (about 427 free). The parser that reads both forms is released first as Gateway code (the release needs a zero-drift baseline, and the live code cannot read a format it does not know); the Terraform that writes the compact form follows once that code is live, together with enabling the variables. Egress mirrors narrative answers; the host is fixed in code. Still at a restore sitting: helper plan and apply, Gateway release, the owner's key, live threshold calibration. |
| D3.2-013 | Owner actions for Jev: create the TypeSafe API key in their console and put it in the secret, confirm TypeSafe's retention terms, and name TypeSafe in the Terms and subprocessor list. | Ready | Owner | None | Retention is not stated in TypeSafe's privacy policy; no real-candidate use before it is confirmed. |

## Exit criteria

- [x] An accountable decision record names the provider and account arrangement and states how it meets ADR-038. Evidence: [ADR-059](../../adr/059-live-generation-through-amazon-bedrock.md), accepted by the owner 2026-11-13, with the checked AWS statements, the residual risks and the rejected alternatives. Real-candidate use stays gated by D6-015 and D6-016.
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

2026-11-13: The owner chose to complete D3.2 and to keep `gpt-6-luna`. Checking the development account showed `gpt-6-luna` is not available to it, and that OpenAI models on Bedrock retain classifier-flagged traffic for up to 30 days unless AWS grants zero data retention, which ADR-038 does not allow. The owner agreed to Amazon Bedrock in our own account with Claude Sonnet 4.6 as the interim model, the model id as configuration, a $20 a month development ceiling with alarms at 50% and 80%, a per-request token cap and a kill switch that is off by default ([ADR-059](../../adr/059-live-generation-through-amazon-bedrock.md)). A later model, `gpt-6-luna` included, is a configuration change plus a fresh check, and only if access and zero retention are obtained. The Ashby live proof (D3.2-007) needs no AI and runs in the live session on a posting the owner picks. Narrative answers (D3.2-009) stay on OpenAI direct.

2026-11-15: First live cover-letter run in development (D3.2-004, sitting day). The first release of the
native-material pipeline is in place (control, task and preparation releases; Gateway cover-letter flags;
the web build flag) and the candidate's Generate cover letter started the real chain: Gateway accepted the
packet, the reconcile nudge reached the queue, the workflow started a Fargate task, and Bedrock recorded one
invocation (2,350 input and 621 output tokens, no errors). The run exposed defects that no test could, fixed
in the change that carries this note: (1) the preparation reconcile Lambda rejected every real EventBridge
scheduled event because EventBridge sends whole-second times and the check required the millisecond form, so
nothing was ever dispatched; (2) the web status poll called `/preparations/` while the contract and Gateway
serve `/packet-preparations/`, so every poll returned 404 (a new test now requires every web upstream path to
exist in the OpenAPI contract); (3) a stale image-proof expectation. Also found: the Gateway function
environment reached Lambda's 4 KB limit when a fifth task revision joined the disposal list, so the retired
`resume:2` was dropped from the Gateway list (the cleanup worker keeps all revisions); each new revision costs
about 230 bytes, so the list must stop living in one environment variable before the next release. Open until
the fixes are released: the task exited about 39 seconds after start (exit 137) while the workflow stayed
running, which needs the status route working to interpret.

2026-11-15 (later): With dispatch and the status route working, the task's silent death was traced. The Fargate
container exited about 15 seconds after it started, right after the model call: the real Sonnet reply was
rejected by the grounding check (`ungrounded_entity`: a paragraph named an earlier employer while citing only a
later job's facts), the generation actor returned `failed`, and the runtime fails closed by killing itself for
any outcome but `ready`, with no logs by design. Reproduced locally with the production provider, gateway and
actor against real Bedrock and synthetic facts: 3 of 4 runs rejected. Telling the model that each paragraph is
judged only against the facts it cites (a restatement of how the check works, not a weaker check) passed 6 of 6.
That rule is in this change; it is baked into the native-material image, so it needs a new image and task
revision. Also seen: a failed attempt leaves an unretired task allocation on the application, and the next
attempt waits for the cleanup worker to retire it.

2026-11-15 (evening): The citation rule alone was not enough on a real candidate. The real task still died
after the model call because the grounding check is mechanical: every capitalized word that does not start
a sentence must appear in the facts that paragraph cites (or in the job title or company), so "Prior to
Meta, ..." in a paragraph citing only another employer, or a technology copied from the posting, rejects the
whole draft. Reproduced with the production provider, gateway and actor on the real candidate's history and
a real posting: 0 of 3 passed with the first rule. A second rule that states this mechanism plainly passed 18
of 18 (and 3 of 3 on a second persona). The check is unchanged. Release lesson: the preparation activity
computes the request hash the task must reproduce, so a prompt change needs the task image AND the
NativePreparation Lambdas built from the same commit. Task logging is off by design, so these failures were
found by CloudTrail (the task role's STS, secret and model calls appear a few minutes late) and by local
reproduction, not from the task.

2026-11-16: Ashby dry run for D3.2-007 in real Chrome (the real unpacked extension on a real public Ashby posting,
every write blocked, a faked platform API, nothing sent to the employer). The adapter, built only against
synthetic pages, failed twice on the real page, both fixed in the change that carries this note: (1) Ashby moves
between Overview and Application without a new document, so Chrome's `sender.url` stayed on the overview and
the background refused the page's proof request; every fill started from the posting's own address aborted at
"revalidate" after recording a dispatched attempt (`sameDocumentPosting`); (2) a multiple-choice question is a
fieldset with its own class and its stable id on the parent, not an entry, so the adapter never saw it, never
counted it as a required question and would have pressed Submit with it empty; the live markup differs from the
2026-10-22 inspection. After the fixes the real page fills name, email, links and the resume attach, leaves the
employer's own questions to the candidate and counts them correctly, and Fill and submit refuses before any
attempt is dispatched while they are unanswered. The post-submit confirmation message is still unobserved: the
live submission by the owner (D3.2-007) is its evidence.

2026-11-18: the owner's first live fill on the Mintlify posting failed with `AshbyFillUnavailable` at "fill" (nothing
submitted, the attempt reconciled and reopened). Reproduced in real Chrome with a saved "no sponsorship needed"
answer in the packet, which the planner maps to the page's multiple-choice question: (1) Ashby draws each radio's
circle itself and lays the real input over it at opacity 0, which the adapter's hidden-control guard refused, so any
saved answer that maps to a choice aborted the whole fill; (2) the page run's written-field check read a choice as a
single `<select>`, which Ashby's buttons and radio groups are not (found while tracing the first). Fixed in the
change that carries this note: a shared guard (`lib/actionable.ts`) accepts a transparent radio or checkbox only when
it has a box, every ancestor is visible and, before a click, the click lands on the input itself; providers can say
how a choice is read (`selectionWritten`); and the Ashby fill now reports the field it is on, so a refusal names it.
Verified in real Chrome against the live page with every write blocked: the fill completes and exactly the approved
option is checked. The live submission itself is still open.

2026-11-18 (later, D3.2-009): on the same posting the AI answer icon did not appear on "Why are you interested in
Mintlify?". The icon only offered itself for a question no packet key matches, and the mapper recognises "why this
company" as `questions.why_company`, a key the Profile never holds an answer for (`explicit_each_time`), so the most
common narrative question was skipped. Reproduced in real Chrome (the click spot hit the textarea, not the icon) and
fixed in the change that carries this note: that key is now drafted like any other open question. Verified in real
Chrome on the live page: the icon is drawn on the box. The live draft itself (the real model) is the owner's test.
The owner confirmed the icon works.

2026-11-18 (owner direction): the "needs you" cases (no match, ambiguous wording, option not on the page, restricted)
for choice questions are to be decided by Jev (TypeSafe), with the candidate's data given to it for accuracy, filled with
confidence, and restricted answers proposed but confirmed one by one by the candidate. Recorded as
[ADR-061](../../adr/061-choice-answers-decided-by-jev.md) with tasks D3.2-010 to D3.2-013; nothing built yet.

2026-11-18: D3.2-010 built locally and dark: the choice-answers route and contract, the Jev client (pinned `jev-1.14.0`,
fixed host, strict response validation, thresholds in code), the context builder (work history, education, skills,
preferences, saved answers and the job; no name, email, phone or address) and the Gateway composition, which classifies
each question itself, gives a restricted question only the candidate's own saved statement and sends nothing without one.
Unit tests cover the thresholds, context bounds and restricted handling; nothing has called the real provider yet.

2026-11-18: D3.2-011 built locally: the pre-fill inspection reports the required choice questions the fill would leave to the
candidate, the background asks the Gateway and chooses the standard answers on the page, restricted answers are proposed in
the panel and chosen only when the candidate confirms each one, and the fill then runs as a fill for review. Ashby only.

2026-11-18: D3.2-012 Terraform for choice answers built and validated locally (`terraform fmt`, `validate`, the infrastructure validation chain; its one failure, the D2 runtime migration-inventory check, also fails on main). Not applied.

2026-11-18 (owner request): the in-person question ("willing to work in our San Francisco or NYC office?") was
left unanswered, and the Job preferences page already holds the candidate's work modes. [ADR-060](../../adr/060-work-location-answers-from-job-preferences.md)
derives Remote, Hybrid and On-site Yes/No answers for the packet from the saved work modes, shown for the candidate's
confirmation (`explicit_each_time`); locations and relocation are not read. Built locally, not released: the packet
builder, taxonomy (both copies), Gateway wiring and planner patterns; verified in real Chrome on the live page (Remote
only presses No, Hybrid and On-site press Yes). Needs a Gateway release at the next restore.

2026-11-18 (release sitting): the Gateway release plan from main 9c360e4c was refused by the release guard
("unrelated data observation"). The live environment now retains the one-off preparation and material-control
modules (release `r1`), and, like the retained resume modules, they depend on the whole platform, so Terraform defers
their no-input caller-identity and region reads when the Gateway changes. The guard named only the two resume modules.
It now also accepts those two modules with the identical exact checks (address, provider, no inputs, unknown-only
values, both reads per module, a retained release for the key); a substituted read or an unretained key is still
refused. The release is repeated from the main that carries the fix.

2026-11-19: Gateway released from main 564bfd65 (work-mode answers live, Jev code dark, compact-deployments parser
live); the first apply was cut off by an expired SSO token after the function update, so the stale lock was removed
with the owner's approval and the same reviewed plan reapplied (applied-and-verified, zero drift). The owner confirmed
the in-person question on Mintlify is answered from Job preferences. Next, the Gateway's retained-deployments variable
is written in the compact form (one cluster named once; the cleanup worker keeps its own list form), which makes room
for the choice-answers variables; then a platform stage enables `choice_answers_enabled`, which creates the TypeSafe
key secret for the owner to fill.

## Risks and blockers

| ID | Risk | Status |
|---|---|---|
| D3.2-R1 | No provider or account the owner has meets the ADR-038 retention limit; the arrangement may need a commercial agreement or a different cloud provider path. | Mitigated 2026-11-13: ADR-059 chose Bedrock in our own account, which does not retain prompts for the chosen model per AWS documentation (an inference for Sonnet 4.6, recorded in the ADR); closes when D3.2-005 shows it with live traffic. |
| D3.2-R2 | Model output may state something the candidate did not claim; grounded validation and review reduce this and the candidate approves every packet. | Open |
| D3.2-R3 | Per-request cost can exceed the Free-tier economics. | Open. Ceiling decided 2026-11-13: $20 a month in development with alarms at 50% and 80% and a per-request token cap (ADR-059); the production quota is a launch prerequisite (ADR-032). |
