# ADR-057: Narrative answers drafted in the candidate's browser

Status: Accepted by the owner's direction 2026-11-07 (development scope); supersedes ADR-030
decision 2 for narrative answers only
Date: 2026-11-07

## Context

Employer forms ask free-text questions such as "What interests you about this role, and what would
you bring to the team?". The deterministic planner leaves these empty for the candidate. On
2026-11-07 the owner asked for a small icon at the bottom left of such a question that drafts a
concise answer from what is known about the candidate. [ADR-030](030-ai-gateway-and-grounded-generation.md)
already defines grounded narrative generation, with a just-in-time disclosure approval per call,
and the owner named OpenAI `gpt-6-luna` for development on 2026-10-02
([D3-012](../security/d3-012-accountable-disposition.md)). [ADR-038](038-one-off-generated-application-materials.md)
covers cover letters and resumes, not these short answers.

The owner chose, on 2026-11-07: OpenAI GPT, set up for scalability and price; the icon is shown
even when the question says it wants an answer written without AI; and consent comes from the
Terms of Service, not a prompt at each use.

## Decision

1. **Shape.** The extension adds an icon beside a free-text question on a provider form the
   candidate is applying to. The Gateway route `POST /v1/applications/{id}/narrative-answers`
   returns one draft for one question. The candidate reads and edits it in the form; the packet,
   approval and submission flow is unchanged and nothing is submitted by this route.
2. **Evidence.** Only the candidate's confirmed, usable, non-restricted Profile facts and this
   application's active job go into the prompt (ADR-030, ADR-052). The question and the employer's
   help text are untrusted data inside a delimiter the text cannot close. The draft is accepted only
   if the grounding checks pass (every number and proper noun is in a cited fact or names the job);
   it is tried once more, then declined as `not_grounded`.
3. **Questions that are never drafted.** Sensitive, restricted, attestation, signature and
   challenge questions, and questions the Profile already answers (salary, notice period,
   relocation, contact and links), are declined before any model call. The Gateway checks this
   itself and does not trust the client.
4. **Consent.** The Terms of Service tell the candidate that AI drafting sends confirmed Profile
   facts and the job text to the model provider. The Gateway records a disclosure for the exact
   purpose (`narrative_answer`) and categories (`profile_facts`, `job_posting`) at each call, so
   the model gateway's disclosure check and its freshness bound stay as they are. This supersedes
   ADR-030 decision 2 (a candidate approval before each call) for narrative answers only. Before any
   real candidate uses it, the Terms must name the provider and these categories (D6, launch gate),
   and [subprocessors](../security/subprocessors.md) must match.
5. **Provider and cost.** OpenAI `gpt-6-luna` through `@ai-job-apply/ai-sdk`, the model the owner
   selected, at the lowest published tier (secondary sources in November 2026: about $0.10 input,
   $0.50 output and $0.01 cached input per million tokens; confirm on OpenAI's pricing page). A draft
   is a few thousand input tokens and a few hundred output tokens, so about a twentieth of a cent.
   The narrative prompt (version 1.1.0) puts the rules, facts and job first and the question last,
   and each request carries an opaque per-application `prompt_cache_key`, so the later questions of
   one application reuse the cached prefix at a tenth of the input price. Output is capped, the
   call is one short synchronous request inside the Gateway's request budget, and responses use
   `store: false`.
6. **No persistence.** The draft is returned once with `Cache-Control: no-store`. It is not stored
   in PostgreSQL, a queue, a log, an idempotency record or a cache, and nothing in a request or
   response is logged. The only stored trace is the provider's own handling (decision 8).
7. **Limits and the kill switch.** Off by default: `NARRATIVE_ANSWERS_ENABLED` and a provider key
   must both be set, and the Terraform variable `narrative_answers_enabled` is the switch that
   turns drafting off without a code release. Each candidate gets a burst limit (6 a minute) and a
   daily limit (60), held in the Gateway instance's memory, so it is best effort across instances.
   The hard ceilings are the Gateway's reserved concurrency and a spending cap the owner sets on the
   OpenAI project. A durable, plan-driven quota (ADR-032) is a launch prerequisite and is not built.
8. **Provider retention.** OpenAI may keep prompts for abuse monitoring for up to 30 days
   ([D3-012](../security/d3-012-accountable-disposition.md)); that is longer than ADR-038's
   30-minute rule for cover letters and resumes, which this ADR does not relax. The owner accepted
   this for short narrative answers in development, for the owner's own account and synthetic
   candidates only. Real-candidate use stays gated by D6-015 and D6-016, and the 30-day retention is
   to be disclosed in the Terms.
9. **Employer instructions.** When a question's own text says the answer must not use AI, the icon
   is still shown, with a one-line notice that the employer asked for a hand-written answer. The
   candidate decides; the platform does not decide for them and does not hide the instruction.
10. **Key handling.** The OpenAI key lives in an operator-populated Secrets Manager secret that
    Terraform creates empty and never reads. The Gateway reads it through the Lambda extension over
    the private endpoint, caches it for ten minutes and keeps a recent key through a brief outage.

11. **Extension.** The unpacked execution build injects `narrative-answer.js` on demand into the
    exact document of the page the candidate prepared (the same moment the application is selected),
    never as a persistent content script. The icon is in a closed shadow root, appears only on open
    textareas that no Profile answer maps to, and is not offered on cover letter or resume fields. The
    background answers only the bound tab, document, top frame and employer origin for 30 minutes, one
    request at a time, using the extension's own session. A draft fills the box only if the candidate
    typed nothing meanwhile, and Undo restores the previous text. The store build has no provider
    host access and therefore no icon.

## Consequences

- A hallucinated employer, fabricated metric or instruction-following injection cannot reach the
  candidate as a draft; the grounding checks reject it, and the candidate reads every draft anyway.
- The checks are conservative and can decline a truthful draft, and a Profile with few confirmed
  facts gets "add your experience" instead of a draft.
- The in-memory limit does not stop a determined caller from using several Gateway instances; the
  provider spending cap does.
- The Terms must be updated before launch, and the provider's 30-day abuse-monitoring retention is
  a disclosed difference from the cover-letter and resume rule.

## Alternatives

- **Amazon Bedrock.** The D3.2 candidate: no new vendor and no retained prompts. Not chosen for this
  feature because the owner chose OpenAI; revisit with D3.2-001 for cover letters and resumes.
- **A consent prompt at each use, or a one-time Profile switch.** Rejected by the owner in favor of
  the Terms of Service.
- **A durable usage table now.** Rejected for this change: a new Applications table also needs
  deletion, restore and export wiring, which is out of proportion for a counter. A plan-driven
  quota is recorded as the launch prerequisite instead.
- **Hiding the icon when the employer asks for no AI.** Rejected by the owner.

## Amendment: Fill and submit offers to write the blocking questions (2026-11-12)

The owner's direction after the first real submission: the candidate should not have to answer an open
question by hand before pressing Fill and submit. They press it once; if a required open question is
empty, the extension asks whether AI should write it, and either way the form is filled first.

- **When.** The readiness check before an attempt (ADR-053 amendment) already finds the required
  questions only the candidate can answer. Those the answer icon can draft (an open, usable, empty,
  required text box that no Profile answer maps to) are counted (`draftable`), and the panel asks
  instead of refusing. Nothing has started and nothing is recorded at that point.
- **The question.** The panel shows the employer's own wording and, when the employer's text asks for
  an answer written without AI, says so (decision 9 stands: the candidate decides). Two choices:
  write with AI, then fill and submit; or fill the rest and leave the answer and the submission to the
  candidate. Consent is that choice, in addition to the Terms (decision 4); no draft is asked for without it.
- **Writing.** The panel asks the background to draft (`application_native_draft`). The background
  proves the same tab, document, approval and packet again, then asks the page script, which reads the
  required empty open questions itself and asks the extension's own answer session for each, one at a
  time, with the existing limits. A draft fills a box only if it is still empty. Only counts come back
  (`drafted`, `declined`, `failed`); no question text, draft or answer is kept or logged by the background.
- **Then.** If every blocking question now holds a draft, the submit run starts again as the candidate's
  choice said. If the engine can write only some, declined, or failed, the extension fills the rest
  (fill for review) and stops, and tells the candidate which drafts to read before they submit.
- **The selection survives.** A run refused before any attempt existed gives the selected page and resume
  back unspent, so the candidate can go on without selecting again.
- **Scope.** Only required, empty, open questions. Optional text boxes stay with the icon. Sensitive, attestation
  and signature questions are never drafted (the Gateway screens them too).
- **Fill for review asks too** (same day, owner: the candidate should "just click our fill"). A fill for review
  that finds a draftable question asks the same thing, worded without any submission (write with AI, then fill for my
  review; or fill the rest and answer myself), and never submits. Once the candidate has chosen, the fill runs
  with `skipDraftOffer`, so it does not ask again. The "still needs you" note counts only questions that are not
  already answered.

Verified in real Chrome on the real Prompt.io form with the answer engine stubbed and every employer
write blocked (the real question named, the draft written into the real box), and on a local synthetic
board through to a confirmed submission. A real model answer for this question was seen once by the owner
before this change (the icon); the full path with the live engine is unobserved.
