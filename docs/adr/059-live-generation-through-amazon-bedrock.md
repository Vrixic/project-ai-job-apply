# ADR-059: Live generation of resumes and cover letters through Amazon Bedrock

Status: Accepted by the owner's direction 2026-11-13 (development scope); real-candidate use stays gated
by D6-015 and D6-016
Date: 2026-11-13

## Context

[ADR-038](038-one-off-generated-application-materials.md) decision 7 allows a model provider for
generated resumes and cover letters only if it establishes no training and no retained prompts or
generated material beyond 30 minutes, including diagnostics and abuse logs. OpenAI direct keeps prompts
for abuse monitoring for up to 30 days ([D3-012](../security/d3-012-accountable-disposition.md)), so D3
closed with live AI off and this decision is task D3.2-001 of [D3.2](../product/delivery/phase-3-2-live-ai-generation.md).
The owner named `gpt-6-luna` for development on 2026-10-02 and again on 2026-11-13.

Checked on 2026-11-13 in the development account (us-east-2, SSO profile `ai-job-apply-development-admin`):

- Amazon Bedrock model invocation logging is not configured (`GetModelInvocationLoggingConfiguration`
  returns no configuration).
- The Converse API answered a synthetic, no-personal-data prompt for `us.anthropic.claude-sonnet-4-6`,
  `us.anthropic.claude-haiku-4-5-20251001-v1:0`, `us.meta.llama4-maverick-17b-instruct-v1:0`,
  `mistral.mistral-large-3-675b-instruct`, `us.amazon.nova-pro-v1:0` and `openai.gpt-oss-120b-1:0`.
- It refused `gpt-6-luna`, `gpt-5.6-luna`, Claude Sonnet 5.5, Claude Haiku 5.5 and Claude Fable with
  "not available for this account". The cross-region quota for GPT-6 Luna is non-zero, so the refusal is
  an account enablement matter, not a quota one. Some older models are end of life.
- AWS's [abuse detection](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html)
  page names the only models whose inputs and outputs are stored: every OpenAI model except the
  gpt-oss family (classifier-flagged traffic, up to 30 days; full zero data retention through the AWS
  account team) and Claude Fable 5, 5.1 and 5.2 (all traffic, up to 30 days). It says retained data is
  held by AWS and not shared with model providers, and that Bedrock uses a zero operator access model.
  Its CSAM exception covers image inputs and outputs; this product sends text only.
- AWS's [data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) page
  says there is no data retention change to Claude models released before Claude Fable 5.
- AWS's [data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) page
  says model providers have no access to their model deployment accounts, to Bedrock logs, or to
  customer prompts and completions.
- The [Bedrock FAQ](https://aws.amazon.com/bedrock/faqs/) says AWS and third-party model providers do not
  use Bedrock inputs or outputs to train any model.

## Decision

1. **Provider.** Amazon Bedrock in the platform's own AWS account (development now; the staging and
   production accounts later), through a `ModelProvider` implementation behind the existing model
   gateway in `@ai-job-apply/ai-sdk`, using the Converse API and `us.` inference profiles (US regions
   only). The gateway's kill switch, disclosure approval, input and output bounds, timeout, strict JSON
   output and grounding checks (ADR-030) are unchanged. This adds no model-provider subprocessor: the
   prompt goes to AWS, which already hosts the platform, not to a model company.
2. **Interim model.** Claude Sonnet 4.6, `us.anthropic.claude-sonnet-4-6`. The model id is configuration
   (a Terraform variable that reaches the generation process), and the gateway records provider, model
   id and prompt version with each result.
3. **Which models may be enabled for ADR-038 purposes.** A model may be enabled only if the AWS pages above
   do not list it as retaining inputs or outputs, or the account has zero data retention for it in
   writing. Changing the model is a configuration change plus a fresh read of those pages, recorded in the
   decisions log below. Today this excludes the OpenAI models other than gpt-oss and Claude Fable 5.x,
   and the models this account cannot call. `gpt-6-luna` becomes possible only if AWS enables it for the
   account and grants zero data retention (the owner may ask the AWS account team; this does not block
   the work). Narrative answers stay on OpenAI direct as decided in [ADR-057](057-narrative-answers-drafted-in-the-candidates-browser.md).
4. **Stays off.** Model invocation logging (in every account that runs this), prompt caching and cache
   points, conversation or session storage, Bedrock Agents, Knowledge Bases, Guardrails traces, batch
   inference, provisioned throughput and image input. Only the synchronous Converse call is allowed. An
   operator check fails the release if a logging configuration appears.
5. **Where it runs.** In the native generation process, where the generated material already lives only
   in memory for at most 30 minutes (ADR-038), reached with the task role's IAM credentials. There is no
   provider key and no provider secret. The role may invoke only the chosen inference profile and the
   foundation models behind it, and holds the permission only while the switch below is on. Private
   egress to the Bedrock runtime endpoint, and any change to the workload permissions boundary, are
   designed and reviewed in D3.2-002.
6. **Limits and kill switch.** Off by default. A Terraform variable turns live generation off without a
   code release or image rebuild, and removing the switch also removes the invoke permission. The
   development spending ceiling is $20 a month, with AWS Budgets alarms at 50% and 80% to the owner. A
   per-request token cap bounds input and output, and the existing single-dispatch admission and
   per-candidate limits bound request counts. The alarms warn; the switch and the permission are the
   hard stop.
7. **Fallback.** When live generation is off, denied, over a cap, unavailable or fails the grounding
   checks, tailoring falls back to the deterministic path and the candidate sees an honest state. The
   fallback keeps working with the switch off (D3.2 exit criterion 4).

## How this meets ADR-038 decision 7

- **No training:** the Bedrock FAQ statement above; model providers cannot see prompts or completions.
- **No retained prompts, including diagnostics and abuse logs:** invocation logging is off and verified;
  the abuse detection page names the retaining models and Sonnet 4.6 is not among them; the generated
  material is also never written by the platform (ADR-038 decisions 1 to 5).
- **Within the window:** nothing is retained at the provider, so the 30-minute bound is set by the
  platform's own expiry, which D3.2-005 proves with live traffic.

Residual risks, recorded plainly:

- Sonnet 4.6 is not named on the retention pages. The conclusion that it is not retained rests on those
  pages naming the retaining models and stating no change for Claude models released before Fable 5. It is
  an inference from AWS documentation, not a statement about Sonnet 4.6 by name, and not a contract.
  D6-015 reviews it and the owner may ask the AWS account team to confirm it in writing.
- AWS can change these terms. The pages are re-read at each model change and before any release that turns
  live generation on in a new account.
- A `us.` profile may process a request in any US region it covers. Nothing is stored there, but the Terms
  must say prompts are processed by AWS in the United States.
- CloudTrail and metrics record that a call happened (model id, counts, sizes), not its text. D3.2-005
  verifies that no prompt or completion appears in any log or trace.

## Consequences

- The model is Sonnet 4.6, not `gpt-6-luna`. Quality is checked by the owner in D3.2-006 and grounded
  validation and candidate review apply as before.
- [Subprocessors](../security/subprocessors.md) names model inference under the AWS row and limits the
  OpenAI row to narrative answers.
- Work order: this record, then Terraform (invoke permission, switch, budget, boundary), then the adapter,
  then resume tailoring and cover letters on it, then one restore sitting for the live proofs.
- Built for D3.2-002 (dark, off by default): the kill switch is the permission itself. Each native resume task role
  receives `bedrock:InvokeModel` on the one profile and its foundation models only while the development
  `live_generation.enabled` input is true, so turning generation off edits one role policy and needs no new task
  revision or release. A private `bedrock-runtime` endpoint with an exact policy (only those task roles, only that
  action and those models), a $20 a month budget alerting at 50% and 80%, an hourly invocation burst alarm, and
  `scripts/verify-bedrock-invocation-logging-off.ps1` (read only; fails if any invocation logging configuration
  exists) complete the controls in decisions 4 to 6. Cost Explorer names the budget filter after the model, so the
  service name is confirmed after the first calls.
- Anthropic models on Bedrock need the account's one-time Anthropic use case details form. On 2026-11-13 the
  account had none on file, so a Sonnet 4.6 call returned `ResourceNotFoundException` (calls earlier the same day had
  worked; Llama 4 Maverick still answered). The form carries organisation details and goes to Anthropic, so the
  owner submits it (or supplies the values and approves a submission) before the first live call. If the owner prefers
  not to, a non-Anthropic model can replace the interim one after the same retention review.
- Sonnet 4.6 on Bedrock is listed at 3 USD per million input tokens and 15 USD per million output tokens, so one
  tailoring call of about 6,000 input and 1,000 output tokens costs about 3 cents and the 20 USD ceiling is roughly
  600 generations a month.
- The development environment is dormant; live tests wait for a restore with the owner.
- The reviewed models live in one file, `infrastructure/terraform/live-generation-models.json`, read by the
  bootstrap boundary and the environment role policy, and a test refuses a model that AWS documents as retaining
  traffic. The workload permissions boundary names the exact profile (a ceiling bound to the native resume task
  roles), so changing the model is a file entry, a bootstrap apply and an environment apply, never only a
  runtime setting. To make room, the boundary's two native task statements for the Gateway and the cleanup worker
  became one statement per cluster naming each principal that retains it (same grants, 304 characters saved);
  the complete development boundary is 5,995 of 6,144 characters with the restore role and live generation on.

## Addendum 2026-11-13: live resume tailoring (D3.2-003)

8. **Selection only.** The model never writes resume text. It is shown the candidate's experience and project entries
   that offer a real choice (two or more bullets), with their bullet ids, and the job, and answers through one forced
   tool with the ids to keep per entry, most relevant first, three to six per entry (all when fewer than three).
   Contact details, education, skills and the summary are not sent. Every word on the tailored resume is therefore a
   node of the candidate's own document: the same structure and the same factuality gate as the deterministic tailor
   (`verifyTailoredFactuality`), and the matched job terms are computed from the kept bullets, never taken from the
   model. Rewriting bullet text is a later decision with its own grounding and layout work (the in-place PDF edit of
   ADR-058 is sized for the candidate's own lines).
9. **Fallback and honesty.** Any refusal, denial, timeout (12 seconds, so a slow model cannot outlast the task's boot
   budget), unusable answer, oversized resume or failed gate returns to the deterministic tailor and the generation
   continues. The path that ran is recorded as the tailoring version (`tailoring.live.v1` or `tailoring.v1`) and is part
   of the content hash the candidate's approval binds to.
10. **Consent.** Purpose `resume_tailoring`, categories `resume_content` and `job_posting`. As for narrative answers
    (ADR-057 decision 4), consent comes from the Terms of Service and the disclosure the gateway checks is created inside
    the task at the moment of the call; no disclosure record, prompt or answer is stored. Before any real candidate
    uses it, the Terms must say that resume text and the job are processed by AWS Bedrock, and
    [subprocessors](../security/subprocessors.md) must match (D6, launch gate).
11. **Wiring and the switch.** The task image configuration gains an optional `liveGeneration.modelId` (validated as a
    US inference profile id; absent means deterministic only), so existing releases stay valid. The kill switch remains
    the task role policy (Terraform), not a configuration flip: with the permission removed the call is denied and the
    deterministic tailor runs, at the cost of one denied call per generation. The image bundle imports only the narrow
    `ai-sdk/bedrock` and `ai-sdk/gateway` subpaths; its build gate still refuses the OpenAI provider and now requires the
    Bedrock client and the live tailor.

## Addendum 2026-11-13: live cover letters (D3.2-004)

12. **Notice and model.** The cover-letter disclosure becomes `bedrock-cover-letter.v1`; the OpenAI notice
    `openai-cover-letter.v1` is retired for new requests. The text names the model and its retention terms, so
    for cover letters the model is bound to the notice version rather than being free configuration: the
    contract names `us.anthropic.claude-sonnet-4-6`, the task image configuration `liveGeneration.modelId` must
    equal it, and a different model needs a new notice version, owner review and a fresh read of the AWS pages
    (decision 3). The wording claims only what the checked statements support: no training, not shared with the
    model provider, the model is not among those AWS lists as retaining, those terms can change, memory only,
    every copy gone within 30 minutes. It keeps the inference of the residual risk visible to the candidate. The
    owner reviews the wording when merging. Where it is shown is the owner's decision in
    [ADR-050](050-generate-then-apply-flow.md): the web step states nothing about the provider and sends the
    version with `acknowledged: true`, and consent is presented in the sign-up terms or privacy policy before
    activation (an open D6 privacy-review item). The Terms and the subprocessor list must therefore name Amazon
    Bedrock and Anthropic's Claude in the same terms as this notice.
13. **Persistence and old rows.** Applications adds migration `0016_cover_letter_bedrock_notice`: one tuple CHECK
    allows the old OpenAI tuple and the new Bedrock tuple, the column defaults become the Bedrock values (the
    Gateway insert relies on them) and existing rows stay valid and immutable. Documents needs no migration: a
    native letter never reaches `ready` (a CHECK keeps native readiness on `pending` rows), so the portable
    export's `model` only describes legacy saved letters, which stay OpenAI. The candidate-data export schema
    accepts both tuples for the preparation record.
14. **One provider path.** The native generation process is the only live cover-letter path. Its image drops the
    provider key, the secret read and the OpenAI client (the image build gate now forbids OpenAI and requires the
    Bedrock client, as the resume image does) and reaches Bedrock on the task role. The native actor accepts only
    the model the notice names. The isolated provider Lambda path (ADR-037, never deployed) is superseded for
    cover letters: it stays compiled and tested with its own OpenAI identity until a cleanup removes it, and
    nothing live accepts that identity. The image imports only the narrow `ai-sdk` subpaths (`bedrock`, `context`,
    `gateway`, `generation`, `prompts`).
15. **No deterministic cover letter.** With live generation off or refused, the candidate writes their own text (the
    disclosure says so); there is no fallback letter.
16. **Definite refusals are a positive non-dispatch.** The single-dispatch rule stays: an exception, a timeout or an
    abort is never proof that nothing was dispatched, and its claim stays unsettled. A definitive service rejection
    is different. Bedrock answers permission denied (the kill switch removes the invoke grant), a model or use case
    the account cannot call, a request it did not accept, or throttling before any model work. The Bedrock transport
    recognises exactly those (a named service error that is a client fault with a 4xx status other than 408, never a
    message) and raises a typed `ProviderRefusedError`; the gateway reports it as a `not_dispatched` receipt with code
    `PROVIDER_REFUSED` on the receipt paths only, so the claim is settled as non-dispatch and the candidate sees
    "generation unavailable" at once instead of a generation that never finishes. Model timeouts and model errors
    (work happened), server faults, aborts and transport errors stay unsettled.
17. **Infrastructure for the cover-letter task.** The native material task module takes the same switchable grant as the
    resume module: `bedrock:InvokeModel` on the one reviewed profile and its foundation models, only while the kill
    switch is on, with the original statements unchanged. Its release object drops the provider secret, the pinned
    version and the key (and the platform's secrets endpoint statement and role policy for them); only the TLS secret
    remains. The private `bedrock-runtime` endpoint policy and security group admit the registered cover-letter task
    roles and groups next to the resume ones, still one `InvokeModel` statement. The permissions boundary ceiling names
    both role families (`native-resume-r*-task` and `native-material-r*-task`) and now has 65 characters of headroom, so
    the next boundary grant needs a lossless compaction first.

## Alternatives rejected

- **OpenAI direct for resumes and cover letters.** Its 30-day abuse retention breaks ADR-038. Kept only
  for narrative answers (ADR-057).
- **`gpt-6-luna` on Bedrock.** Not enabled for this account today, and OpenAI models other than gpt-oss
  retain flagged traffic unless zero data retention is granted. A later configuration change if both are
  obtained.
- **Claude Fable 5.x.** AWS retains all traffic for up to 30 days; zero data retention needs the
  Enterprise Frontier Safeguards program.
- **gpt-oss, Llama 4 Maverick, Mistral Large 3, Nova Pro.** Callable today and possible fallbacks, each
  needing the same page check; weaker for grounded writing than the chosen model.
- **A direct Anthropic API account.** A new subprocessor with its own retention terms, not evaluated.
- **Self-hosted model.** Cost and operations out of proportion for development.

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-11-13 | Bedrock in our account with Claude Sonnet 4.6, model id as configuration. | `gpt-6-luna` is not available to the account and would not meet ADR-038 without zero retention; owner agreed. |
| 2026-11-13 | $20 a month development ceiling, alarms at 50% and 80%, kill switch off by default. | Owner agreed to the recommendation. |
| 2026-11-13 | Cover letters on Bedrock under the new notice `bedrock-cover-letter.v1`, model bound to the notice (addendum 12 to 16). | The disclosure names the model; one live path; the OpenAI notice would be false. |
