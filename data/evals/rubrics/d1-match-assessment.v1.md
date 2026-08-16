# D1 Match-Assessment Evaluation Rubric v1

Status: Candidate; Product and QA approval not recorded

Scope: generated-synthetic scenario coverage for the already approved US-English early/mid-career
software, data, and product launch segment. The set does not reopen that launch decision.

## Automated release thresholds

This deterministic safety and grounding set has no weighted aggregate. Every threshold is
release-blocking:

- all 36 cases have strict versioned structure, unique identifiers, synthetic classification, and
  no prohibited candidate or provider material;
- all six role-family/career-stage cells contain exactly the four required core scenarios;
- all 36 cases return the exact expected outcome class;
- all 34 successful assessments return the exact expected gate and all nine ordered evidence
  tuples, for 306 of 306 exact tuples;
- all 13 explicit known-conflict cases are excluded, and none of the 21 non-conflict assessment
  cases is falsely excluded;
- both legacy-sponsorship cases fail closed without disclosing or using the boolean value;
- deterministic replay is exact for all 36 cases;
- all 15 reason codes and both gate summaries map to fixed candidate-facing copy; and
- no result or copy claims a score, rank, fit band, eligibility decision, application outcome, or
  inference from unknown evidence.

Any miss fails the candidate. Passing these thresholds proves deterministic conformance to the
current conservative baseline, not general relevance, ranking, calibration, real-user usefulness,
provider-data quality, or production behavior.

## Accountable human acceptance

Automated checks cannot close D1-R2. Before the set is called accepted, the Product owner must
record approval of the six-cell taxonomy, all case labels and expected outcomes, these thresholds,
the exact candidate-facing copy, and the current baseline limitations. Those limitations are: no
score, rank, or fit band; no semantic title or location matching; and no comparable compensation,
authorization/sponsorship, seniority, blocked-company, or qualification evidence.

QA must separately review case correctness, coverage, and reproducibility. Repository authorship,
test success, or code review is not Product or QA acceptance. A later governance-only record may
cite an accountable dated decision; this source packet must not fabricate one.
