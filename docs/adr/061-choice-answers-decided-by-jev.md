# ADR-061: Choice answers decided by Jev

Status: Accepted by the owner's direction 2026-11-18; not built, no deployment
Date: 2026-11-18

## Context

The extension plans every employer field against the approved packet. A field it cannot answer is left
to the candidate as "needs you": no packet key matches, the wording is ambiguous, the page offers no
option equal to the approved value, or the answer is restricted (authorization, sponsorship,
demographics, disability, veteran status, attestations). The AI answer icon
([ADR-057](057-narrative-answers-drafted-in-the-candidates-browser.md)) writes free text only and never
picks an option. [ADR-060](060-work-location-answers-from-job-preferences.md) answers three work-location
questions from the saved work modes. Everything else that is a choice is still the candidate's to click.

The owner decided on 2026-11-18 that these choice questions are answered by AI, specifically Jev, and
that the candidate's data is given to Jev so its answers are accurate and can be filled with confidence.
Jev is TypeSafe's System One model: it returns typed decisions, not prose. A Choice question selects one
option from a set and returns a probability for every option plus a confidence; a Noul question returns
the probability that a statement is true. It does not generate text. TypeSafe's privacy policy says it
will not train or fine-tune on Input and will not disclose Input beyond its service providers; it states
no retention period.

## Decisions

1. **Choice questions only.** Radio, select, checkbox and Yes/No fields the planner leaves to the
   candidate. Open text stays on ADR-057. A typed signature, a date of signing, a CAPTCHA or MFA step
   is never Jev's and never the extension's: those remain the candidate's.
2. **Flow.** The extension sends the Gateway only each question's page label and its option labels (no
   page values, no candidate data). The Gateway builds the context server-side for the signed-in owner,
   calls Jev, and returns per question: the option, its probability, the confidence and whether any
   option fits. The route is owner-scoped, `no-store`, and persists nothing.
3. **Questions asked.** One Choice per field, over the page's own options, plus a companion Noul
   ("does the context contain what is needed to answer, and does an option fit?"). If no option fits or
   the context does not contain the answer, the field stays with the candidate.
4. **Thresholds.** An answer is acted on only when its probability, its confidence and the companion
   Noul clear thresholds held in configuration, higher for riskier questions. The first values are set
   with the owner against live Jev before real-candidate use. Below them the field stays with the
   candidate, exactly as today.
5. **Standard questions: fill and flag.** The extension fills the chosen option, marks it "AI chose" in
   the panel list with Undo, and leaves everything below the thresholds to the candidate.
6. **Restricted questions: propose, confirm each.** Owner decision 2026-11-18. Jev may propose an answer to
   a restricted question, and the candidate must confirm each one individually in the panel before it is
   used. Nothing restricted is filled without that confirmation, and confirmations are never batched.
   This extends the mandatory review of [ADR-010](010-restricted-answer-vault-and-mandatory-review.md);
   it does not remove it. A restricted proposal is made only when the context holds an explicit statement
   by the candidate on that topic (a saved restricted answer, a confirmed profile statement or a saved
   preference). Gender, race and ethnicity, disability and veteran status are never inferred from a
   name, history or any other fact; with no explicit statement they stay with the candidate.
7. **Data given to Jev (owner direction 2026-11-18).** The context is the candidate's confirmed Profile
   facts (work history, education, skills), Job preferences, saved answers and the job posting; for a
   restricted question, also the candidate's own saved statement on that one topic. Name, email, phone and
   address are not sent: no choice depends on them. The Terms of Service are the consent, as in ADR-057,
   and must name TypeSafe as a provider with the categories above. The Gateway records a disclosure for
   the exact purpose and categories at each call. Our side stores neither the context nor the answers, and
   logs only counts.
8. **Provider path.** Direct to TypeSafe's API, not through a broker. The key lives in Secrets Manager,
   created empty by Terraform and filled by the owner, read only by the Gateway. Egress is limited to the
   TypeSafe API host. A kill switch defaults off, with per-user rate limits. Every failure, timeout or
   refusal leaves the questions with the candidate.
9. **Retention is an open fact.** TypeSafe states no retention period. The owner confirms it with
   TypeSafe before any real-candidate use; the code cannot establish it. Development use stays on
   synthetic and the owner's own data.

## Consequences

Fewer questions are left to the candidate, with every restricted answer still confirmed by them. Jev adds
a third-party data flow (provider, categories, Terms, subprocessor list) and a Gateway release plus
Terraform for the secret, egress and kill switch. Accuracy depends on the profile: with thin evidence
Jev correctly declines and the question stays with the candidate.

## Build slices

1. Contract, Jev client and Gateway route with the context builder, thresholds and kill switch (dark).
2. Extension: collect unresolved choice questions, apply and flag, Undo, and the restricted confirmation
   list; verified in real Chrome against a stubbed route.
3. Terraform and release at a restore sitting, then calibration of the thresholds against live Jev with
   the owner.

## Implementation notes (slice 2, 2026-11-18)

Building the extension side settled four points the decisions above left open:

1. **Before the fill, not after.** A fill consumes the selected page and spends the page script on
   purpose (one effect per document), so a choice step cannot follow it. The pre-fill inspection, which
   already knows which required questions the fill will leave to the candidate, reports the unanswered
   required choice questions. The extension decides them first, waits for the candidate on any
   restricted proposal, then runs the fill. AI therefore never overrides an answer the approved packet
   gives.
2. **No programmatic Undo.** Decision 5 said "with Undo". A radio group or a Yes/No pair cannot be
   cleared reliably through a page's own framework, so the panel lists every AI-chosen answer with its
   question and the candidate changes a wrong one on the page. A submit run that AI-chose answers
   becomes a fill for review: AI choices are never submitted without the candidate's check.
3. **Restricted answers are confirmed in the panel before the fill**, one at a time, with the question,
   the proposed option and its probability; "I will answer it myself" leaves it to the candidate. The
   proposal lives in the extension's memory for this page only, and the page script re-checks the form
   hash, that the question is still unanswered and that the option is on the page before it chooses.
4. **Ashby first.** Choosing an option is a provider capability (`chooseOption`); Ashby has it. A
   provider without it (Greenhouse today) gets no AI choices and behaves as before. Any failure of the
   Gateway, including a route that is not released yet, leaves the questions with the candidate.
5. **Egress is a code limit, not a network allowlist (slice 3, 2026-11-18).** Decision 8 says egress is
   limited to the TypeSafe API host. That holds in code (the client calls one fixed URL and refuses
   redirects); the Gateway Lambda reaches the internet the same way it does for narrative answers, so
   Terraform adds no network rule. The Gateway environment grows by about 176 bytes (kill switch and the
   key's ARN). Measured against the live function as compact JSON, that is 4,091 of 4,096 bytes with the
   list form of the retained-deployments variable, so the variable gets a compact form that
   names the cluster once (3,669 bytes); one parser reads both forms. Order matters: the parser is released as
   Gateway code first, and only then does Terraform start writing the compact form.
