# D1 Match-Assessment v1 Product and QA Acceptance

- Status: Accepted
- Decision date: 2026-08-17
- Product owner: Vrij
- QA reviewer: Codex QA reviewer `/root/remaining_decisions_audit`
- Delivery effect: D1-R2 is closed; D1-005 and Phase 1 remain In progress

## Accepted immutable candidate

This disposition accepts the exact generated-synthetic D1 match-assessment v1 candidate merged by
[PR #312](https://github.com/Vrixic/project-ai-job-apply/pull/312) at
`cfa09ecbd74af7c558cd7d097cacb166010add73`, with reviewed 11-file manifest
`54f4d58a43f351466ccfe3520ff9a411e29c6a48c7eabe1120086c7e9cc8939f`.

The accepted product/QA boundary is the immutable combination of:

- the 36-case, six-cell generated-synthetic
  [corpus](../../../../data/evals/matching/d1-match-assessment.v1.json), including its labels and
  exact expected outcomes;
- the all-or-nothing [v1 rubric](../../../../data/evals/rubrics/d1-match-assessment.v1.md), including
  every release-blocking threshold and the excluded-versus-review-required semantics; and
- the exhaustive fixed [candidate-facing copy](../../../../frontend/web/app/match-assessment-copy.ts)
  for both gates, all 15 reason codes, and the nonclaim.

No byte in that source candidate is changed by this governance disposition. Any material change to
an accepted input, expected result, taxonomy, threshold, gate semantic, reason mapping, or fixed
copy requires a new version and renewed accountable Product and independent QA review.

## Accountable decisions

### Product

On 2026-08-17, authenticated requester and product owner Vrij instructed the team to “go with your
recommendations.” The recommendation presented was to accept the exact PR #312 v1 corpus, rubric,
and fixed copy together with their documented conservative limitations. This record therefore
attributes Product approval to Vrij for the six role-family/career-stage cells, case labels and
expected results, all-or-nothing thresholds, excluded-versus-review-required behavior, exact fixed
copy, and the limitations below. It does not infer a legal name, handwritten signature, Git author,
or GitHub identity.

### Independent QA

On 2026-08-17, Codex QA reviewer `/root/remaining_decisions_audit` performed an independent
read-only QA review at current-main `2744353599a302170ae6e4d0a53391c7d3cdcd5f` and issued this
verdict: **QA ACCEPT — no corpus, rubric, evaluator, or candidate-copy fixes required.** The review
reproduced 36/36 cases: 13 exact known conflicts excluded, 21 nonconflicts review-required, two
legacy-sponsorship cases unavailable, zero failures or false exclusions, and 306/306 exact ordered
evidence tuples. It confirmed the same four core scenarios in each software/data/product ×
early/mid cell, all 12 guardrails, all 15 reason codes, deterministic replay, and that unknown or
semantic-near evidence never excludes. Career stage remains evaluation metadata only and is not
received or inferred by the kernel. This attribution names the reviewer transparently; it does not
represent the agent as a human signer or infer an external identity.

## Accepted limitations and nonclaims

This acceptance means the deterministic candidate is a suitable generated-synthetic D1 baseline.
It does not claim statistical or demographic representativeness, provider representativeness,
real-candidate behavior, general relevance, semantic title or location matching, comparable
compensation, authorization/sponsorship assessment, seniority, blocked-company, or qualification
evidence. Exact known work-mode or employment-type conflicts may exclude; absent, unknown, or
unassessed dimensions remain review-required; exact title/location overlap is supporting evidence
only.

The candidate does not produce or validate a score, rank, fit band, eligibility decision,
calibration, application outcome, hiring outcome, or real-user/provider product quality. Product
and QA acceptance does not establish production behavior or close any release, managed-OIDC,
browser, accessibility, security/privacy, legal, deployment, migration, AWS, provider, or real-data
gate.

## Delivery disposition

- D1-R2: Closed by this exact Product and QA acceptance.
- D1-005: In progress; all remaining implementation, publication, migration, deployment, browser,
  managed-OIDC, saved-job, stale-cursor, and product acceptance gates retain their recorded state.
- Phase 1: In progress; every current Phase 1 exit criterion remains unchecked.
- Authorization: no API/event/domain contract, application source, workflow, AWS/Terraform,
  migration, deployment, activation, provider access, or real-data action is authorized.
