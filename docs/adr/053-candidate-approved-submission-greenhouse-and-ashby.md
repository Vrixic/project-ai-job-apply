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

## Consequences

- Backend: one new rule in the Applications binding resolver and a test, no schema change.
- Extension: the `greenhouse/*` modules become one provider module among two; the content script is
  provider-neutral; the apply intent and native transfer accept either provider's employer URL.
- Web: no new approval step. Apply keeps its single click.
- Risks accepted by the owner: a mapping error can put a true answer in the wrong field, which is why
  unknown or duplicate controls fail closed; the provider's anti-abuse may reject the click; and
  confirmation detection needs live tuning.
