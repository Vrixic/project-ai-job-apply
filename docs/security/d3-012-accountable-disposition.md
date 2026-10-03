# D3-012 Accountable Disposition (development scope)

- Status: **Effective when the accountable individual merges the pull request that adds this file; that merge
  is the acknowledgement recorded at the end.** Prepared 2026-09-19 from the product owner's chat positions
  recorded in the [approval packet](d3-application-approval-packet.md).
- Task: D3-012. Release gates: LR-D3-01 (application preparation) and LR-D3-02 (application submission)
  in the [legal review register](../product/foundation/legal-review-register.md).
- Basis: the [approval plan](security-privacy-approval-plan.md) allows one person to hold several roles in
  early development but requires the actual accountable individual to be named; legal review is deferred to
  D6-016 ([ADR-019](../adr/019-defer-foundational-counsel-review-to-public-launch.md)) and independent
  security review to D6-015 ([ADR-020](../adr/020-defer-accountable-foundation-security-review-to-launch.md)).
  This record is a development-scope disposition by the product owner. It is not legal advice, not an
  independent security or privacy review, and not counsel's conclusion.

## Accountable individual

| Field | Value |
|---|---|
| Name | Vrij Patel (legal name given by the accountable individual in chat, 2026-09-19) |
| Roles held | Product owner and accountable reviewer for development scope (owner statement, 2026-09-19) |
| Independence and conflicts | None claimed: the reviewer is also the repository owner, so this is not an independent review |
| Scope reviewed | The repository at the merge commit of this record's pull request (#417) and the deployed development environment as of 2026-09-19 (Gateway alias 79, document processor alias 11) |
| Jurisdiction and source-policy versions | None selected and none reviewed. No jurisdiction has been chosen, and no Greenhouse, Lever, or Ashby terms, robots policy, or API policy has been reviewed by counsel or by the reviewer, so this record cites no source-policy version. LR-D3-01 and LR-D3-02 stay `Not started` in the [legal review register](../product/foundation/legal-review-register.md), and each ATS variant needs its own source review at D3-013 before its fixtures are accepted |

## Scope of this disposition

Applies **only** to the development environment and to candidates the accountable individual controls (the
reviewer's own account and generated-synthetic candidates). It does **not** authorize any other real
candidate, staging or production use, public launch, or any provider whose terms have not been reviewed.
Real-candidate use, public policy, and counsel's conclusions remain gated by D6-015 and D6-016.

## Dispositions

| # | Decision | Disposition | Permitted | Prohibited | Conditions (owner, closure evidence) |
|---|---|---|---|---|---|
| 1 | AI processing | Accepted in principle, provider not chosen | Sending confirmed, non-restricted facts and job text to a model provider after the user is told, once a provider, model, and terms are chosen and this record is updated | Any real model call before that update; restricted, never-infer, attestation, signature, and challenge fields in a prompt; unreviewed generated text reaching an employer | Reviewer chooses provider, model, terms, and disclosure text and records them here (reviewer; this file updated) |
| 2 | Form actions | Accepted | The extension filling fields on Greenhouse, Lever, and Ashby pages for the reviewer's own account, per exact variant that has accepted provider-derived fixtures, with the adapter kill switch on and the candidate's approval bound to the packet hash | Any variant without accepted fixtures; any page action on an unsupported form; bypassing a challenge | Fixtures accepted (D3-013); live effects flag set only by a merged change citing this record |
| 3 | Sensitive fields | Accepted: answers are kept | Storing the candidate's own answers, always shown for review and never inferred | Reuse across contexts the candidate did not confirm; automatic filling of restricted answers | The accepted ADR-010 separate-key and least-privilege requirement is **not** amended by this record; the reviewer decides before any real-candidate use whether to keep it (reviewer; ADR-010 updated or the vault built) |
| 4 | Signatures, attestations, CAPTCHA, MFA | Always manual | The candidate completing them by hand | Any automation of them | None |
| 5 | Submission | Accepted with attribution | A candidate-approved, hash-bound packet submitted through an accepted adapter; every result recorded with who submitted (platform adapter, or the candidate through takeover or attestation); an ambiguous result blocks a second submission until reconciled | Blind retry after an ambiguous result; recording a candidate submission as a platform one | Confirm the history fields suffice or add an explicit submitter field before the extension executor ships (engineering; D3-008 closure) |
| 6 | Engineering defaults | Accepted as listed in the approval packet | 24-hour approval; 0.90 auto-review threshold; one live application per job; duplicate-risk acknowledgement for "not submitted"; 15-minute AI disclosure approval | Changing them without updating this record | None |

## OpenAI development decision (2026-10-02)

Vrij Patel selected OpenAI `gpt-6-luna` in chat and answered "yes" to the development data-handling
scope: only the reviewer's own account and generated-synthetic candidates, explicit disclosure,
restricted facts excluded, and mandatory draft review. This is an accountable development
decision, not counsel, procurement, independent security review, or public-launch approval.
The amendment becomes effective on the owner's merge of the accompanying backend adapter PR.

The reviewed technical basis is OpenAI's
[model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) and
[data controls](https://developers.openai.com/api/docs/guides/your-data), accessed 2026-10-02.
API content is not used for training by default unless the customer opts in. Default abuse
monitoring can retain prompts/responses for up to 30 days, with longer legal/safety exceptions.
`store: false` disables ordinary Responses persistence, not abuse monitoring or all application
state; encrypted prompt-cache tensors can remain for up to 24 hours. No Zero Data Retention
approval is claimed. Model access in the platform's account has not been tested.

Proposed candidate notice, to be reviewed with the separately approved API/consent wiring:
"With your permission, we send your confirmed, non-restricted career facts and this job's text
to OpenAI (gpt-6-luna) to draft this cover letter or narrative answer. OpenAI does not use API
content for training by default. Provider abuse-monitoring logs may retain content for up to
30 days, with longer legal or safety exceptions; temporary prompt caching may also retain data.
You must review the draft before it can be used. You can decline and write your own text."

This narrows disposition 1's unselected-provider blocker to the named development selection.
It does not approve a particular contract/DPA version, legal entity, region, procurement terms,
or an exact candidate notice implementation. Those details remain unrecorded; the general
[subprocessor activation gate](subprocessors.md#activation-gate) is not waived. No real model
call is authorized by this code slice: the adapter remains uncomposed and default-off, and live
evaluation/activation needs the remaining provider conditions and reviewed consent wiring.
No restricted, never-infer, attestation, signature, CAPTCHA or MFA data is permitted in prompts.
No other real candidate, staging, production, employer submission, or backend API change is approved.

## Source-only background lifecycle scope (2026-10-03)

The owner approved source-only provider-stop/retention work and then the temporary background
response retention tradeoff. OpenAI's [background documentation](https://developers.openai.com/api/docs/guides/background)
describes roughly ten minutes of temporary polling state even with `store:false`. This is not
an exact maximum or Zero Data Retention. The initial known-reference stopping/disposal transport
is default-off and cannot create a model response. The foreground adapter is unchanged.
Immutable durable identity capture, gateway-controlled original dispatch, private-writer drain,
disposal reconciliation, reviewed notice/consent, runtime/IAM and accountable activation evidence
remain required. No real model call, new candidate scope, production, deployment or provider-wide
deletion assurance is approved. Response deletion does not remove the previously recorded
abuse-monitoring/legal/safety exceptions.

## Revalidation triggers

Revisit this record when any of these change: an AI provider or model is chosen or replaced; a new ATS adapter
or variant is added; a source's terms change; a second real candidate or any staging or production use is
proposed; the answer vault stores real data; or a security incident involves application data.

## Acknowledgement

Vrij Patel, the accountable individual named above, acknowledges the conditions above by merging the pull
request that adds this file. The merge commit and its GitHub timestamp are the date and the record of that
acknowledgement. Until then this file is a proposal and nothing in it is in force.

## What this does not do

It does not enable live ATS effects (they stay off until D3-013 fixtures are accepted and a merged change cites
this record), choose an AI provider, amend ADR-010, or replace counsel's review (D6-016) or the independent
security review (D6-015).
