# ADR-053: Candidate-approved submission for Greenhouse and Ashby

Status: Accepted by the owner's direction 2026-10-22; implementation in progress
Date: 2026-10-22

## Context

The owner asked for Greenhouse and Ashby applications to work fully: the extension fills the
employer form in the candidate's own Chrome, attaches the resume and submits. Three things stood in
the way.

1. ADR-050 and the approval packet say the extension never clicks the final submit, while the dark
   Greenhouse path of ADR-049 clicks it once. The owner chose the second behavior for both providers
   (decision 1 below), so the stated rule changes rather than the code.
2. The Apply flow of ADR-050 approves a packet that has no form binding, but the execution path
   requires a packet bound to an observed form hash, so a connected run could never start.
3. The execution path exists for Greenhouse only. Real pages inspected read-only on 2026-10-22
   showed that its assumptions miss both providers:
   - Every Greenhouse board page (`job-boards.greenhouse.io`) carries an invisible reCAPTCHA badge
     and response field. The current challenge selector matches `captcha` in any class or id, so it
     treats every page as a challenge and never submits.
   - The form is `form#application-form`, but its controls have no `name`, and country, location and
     question dropdowns are custom comboboxes.
   - Ashby (`jobs.ashbyhq.com/<org>/<job>/application`) has no `<form>` element. Fields are keyed by
     UUID names with `label[for]`, Yes/No questions are `button[data-option]` pairs with
     `aria-pressed`, the submit control is a `button` without a type, and it also carries an invisible
     reCAPTCHA Enterprise frame.

Nothing here has been exercised against a live employer. Confirmation selectors could not be observed
because that needs a real submission, which was not made.

## Decisions

1. **The extension may click the employer's submit control once, after two candidate acts.** The
   candidate's Apply on the website approves the exact packet (ADR-050), and the candidate's explicit
   confirmation in the extension on the employer tab starts the run (arm, then confirm). No click happens
   without both. This supersedes the "never clicks the final submit" statements in ADR-049, ADR-050 and
   the approval packet. Everything else in ADR-049 stays: durable dispatch before any employer effect,
   one-shot click, no retry, positive provider evidence before confirmed history, ambiguous outcomes
   reconciled by the candidate.
2. **A packet with no form binding may be executed, with the form bound late.** ADR-050 removed the
   per-question review, so the candidate approves answer values, not a field layout. A packet that has
   no form binding and no saved-answer (vault) references may start an adapter attempt for an adapter
   in the reviewed list. The Applications service then skips the `form_changed` comparison for that
   attempt. The extension still computes the observed form hash and binds its own inspection, command
   and result to it, and fills only fields whose key exists in the approved packet. An unknown
   required control, a validation error, a custom widget it cannot drive exactly, or a structure that
   changes during the run returns the page to the candidate without a click. A packet that has a form
   binding or vault references keeps the exact-hash comparison.
3. **Provider modules share one interface.** Greenhouse and Ashby each supply identity (host and
   path), inspection, ordinary-field fill, file attach and a reviewed profile (submit and
   confirmation selectors). The executor, native transfer and apply-intent code select the module by
   the employer URL. Page data never chooses selectors.
4. **Invisible reCAPTCHA is not a challenge; an interactive one is.** The invisible badge, its
   response textarea and its anchor frame do not stop a run. A visible challenge frame, hCaptcha or
   Turnstile widget, a one-time-code field or a password field does, and then the run fills what it
   can and hands the page to the candidate as before. The extension never reads or sets a challenge
   token and never solves anything. Clicking submit is an ordinary page action; if the provider then
   shows a challenge the run stops and reports `challenge_required`. A provider that scores the
   click as automated may refuse or flag it; that is a provider decision the extension cannot see, so
   such a result is reported as unrecognized and the candidate reconciles it.
5. **Confirmation is positive evidence or nothing.** Each provider profile names a confirmation
   marker. If it is not seen after the click the attempt is ambiguous and the candidate records the
   outcome (existing behavior). Neither provider's confirmation marker has been observed against a
   live submission; the first real run, performed by the owner, is the first evidence and the
   profiles are expected to need adjustment then.
6. **Controls.** The kill switch for each provider stays default off in every build and is enabled
   by the reviewed build configuration, together with the owner's live-effects approval recorded in
   this ADR. The registry no longer requires a QA-representativeness date (removed by the owner on
   2026-10-21); it still requires provider-derived, scanned and authorized fixture evidence bound to
   the exact adapter version and implementation hash. The production extension distribution still needs
   the legal and security reviews (LR-D3-01/02); this ADR changes nothing about those gates.

## Amendment 2026-11-05: exact selection in custom dropdowns

The Greenhouse board lists some fields (school, degree, discipline) in custom dropdowns, not native
selects. The extension now drives such a dropdown only when an approved packet value maps to the
field: it opens the dropdown with a mouse press and release, searches it by typing the value when the
list is long, and chooses the one option whose text is exactly that value (case and spacing aside).
A degree is also matched to its listed level by a fixed table in `lib/greenhouse/combobox.ts`
("Bachelor of Science" to "Bachelor's Degree"); that table is the only mapping. No exact option, a
doubt, or an answer the candidate already chose leaves the dropdown to the candidate, with its typed
search cleared. For school, degree and discipline only, a value the board does not list gets the
board's own "Other" entry instead (owner direction 2026-11-05), and the popup says so; it also says
how many required questions still need the candidate. Restricted fields (authorization, demographic, disclosure and the like) are still never
filled. A "Preferred First Name" nobody saved defaults to the approved first name, as the full name is
composed from the first and last name; it adds no new candidate fact. Attached files are named
`First_Last_Job_Title.pdf` from the approved names and the job title the extension read itself.

## Enabling (D3-159)

The execution build enables providers by name through `EXTENSION_APPLICATION_EXECUTION_PROVIDERS_JSON`
(unique subset of `greenhouse` and `ashby`; empty or absent leaves every kill switch off). The build
records the owner's live-effects approval and evidence naming the exact adapter version, the reviewed
variant and a SHA-256 of the provider source it contains. The evidence is structure-only (no provider
content is stored, so there is nothing to scan) and expires 90 days after the build, which makes an old
build stop acting rather than trust page structure that may have changed. The registry no longer
requires a QA-representativeness date (removed by the owner on 2026-10-21).

## Consequences

- Backend: one new rule in the Applications binding resolver and a test, no schema change.
- Extension: the `greenhouse/*` modules become one provider module among two; the content script is
  provider-neutral; the apply intent and native transfer accept either provider's employer URL.
- Web: no new approval step. Apply keeps its single click.
- Risks accepted by the owner: a mapping error can put a true answer in the wrong field, which is why
  unknown or duplicate controls fail closed; the provider's anti-abuse may reject the click; and
  confirmation detection needs live tuning.

## Amendment: run budget, interrupted attempts (2026-11-06)

Owner test: a fill stopped at `page-fill>dispatched:identity` and the job page showed an empty
"Apply to this job" section. Reproduced in real Chrome: every field is preceded by a freshness
check that reads the platform (application, job, material authorization, application again), so on
a real connection a fill of a dozen fields spends the whole 60-second run lease and the next check
refuses. A refused run after dispatch was also never reported, because the run's own stop signal
had fired, so the attempt stayed `dispatched` and the application `submitting` until the platform's
15-minute sweep.

- A run that can submit keeps the 60-second lease. A fill-only run submits nothing and is reviewed
  and submitted by the candidate, so it gets 5 minutes, still bounded by the approval and material
  leases (`lib/execution-budget.ts`; the API client, the page entry and both provider fills take the
  budget from the mode instead of a fixed 60 seconds).
- The independent reads of a freshness check go out together; the application is still read once
  more after all of them, and every result is still checked.
- A dispatched attempt that does not finish is reported (`unrecognized_response`, which the platform
  records as ambiguous) however the run ended, with a separate 15-second budget that authorizes no
  page action and requires the same signed-in owner. A run the owner stopped (cleared, signed out,
  page moved) is left to the sweep, as before.
- The job page shows an interrupted attempt ("has not reported back", nothing was submitted) with a
  Check again button and a light poll, instead of an empty section.

## Amendment: salary questions (2026-11-06)

The planner and the Greenhouse custom-dropdown fill answer the three shapes of salary question from
the candidate's one desired annual salary (`packages/ats-sdk/src/salary.ts`):

- an input box (text or number) gets the number as written;
- a dropdown or radio list of ranges gets the range that holds it, and when none does the closest:
  the highest range when the salary is above all of them, the lowest when below all, the nearer one
  between two. A salary on the boundary of two ranges belongs to the one it starts. This is the one
  place a nearest option is chosen; the fill reports it ("none of the ranges held your salary, so the
  closest one was chosen: check it"). Options that are not ranges ("Prefer not to say") are ignored;
  with no range at all nothing is chosen;
- "does the posted salary meet your expectations?" (`job.salary_acceptable`, derived from the
  salary and the range the question itself posts) is Yes when the posted range can pay the salary
  (the salary is at or below the top of the range) and No when it tops out below it. A range posted
  above the salary meets it, so that is Yes. A question that posts no range is left to the candidate.

Only annual dollar amounts are understood: a question or option that says hourly, monthly, weekly,
or names another currency is left to the candidate, and a number is never converted or guessed.
Verified in real Chrome on the real Prompt.io form (posted $100,000-$150,000): 120,000 and 90,000
answer Yes, 200,000 answers No.

## Amendment: readiness before the attempt is dispatched (2026-11-12)

A live "Fill and submit" pressed before the candidate had answered the required free-text question was
refused by the page run (`precondition_failed`), but only after the attempt had been dispatched, so the
platform recorded it as ambiguous and the application sat in "confirm submission status" although
nothing had been filled or clicked. Dispatch stays the durable point before any employer effect
(decision 1 and ADR-049 are unchanged). What changes is that the question is asked first:

- A submit run (not a fill for review) adds `readiness` to the existing read-only inspect message: the
  approved answers the run would use, the provider variant and the file kinds. The page plans exactly as
  the run will and answers with `needs`, a count of required questions only the candidate can answer
  that are not complete (`incompleteCandidateControls`, the same function the run uses; it reads
  validity and emptiness, never a value, and the answers it carried are dropped after the reply).
  The reply also names the first five (`waiting`): the employer's own question labels, cleaned to bounded
  plain text (`questionLabels`), shown by the panel as text. Never anything the candidate entered. (Added
  the same day: a bare count left the candidate unable to tell which question was meant.)
- With `needs` above zero, and no challenge on the page, the executor returns `page-not-ready` before
  `attempt-start`: no attempt, no dispatch, no result, nothing to reconcile, and the application stays
  approved. The panel says how many questions are left and to press again once answered.
- A fill for review does not ask (the candidate completes those controls themselves), and a page with a
  challenge is not held back (it is filled and left to the candidate, as before).
- The answer is required of a submit run: a page that does not answer is refused before any attempt.
- The run's own check stays, so a page that changes between the question and the click is still refused
  after dispatch, and still recorded as ambiguous.

Verified in real Chrome on the real Prompt.io form with every employer write blocked: with the question
empty nothing is posted to the platform and the application stays approved; with it answered the run goes
on and starts its attempt.
