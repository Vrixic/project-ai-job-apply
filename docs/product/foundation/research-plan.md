# Optional Application-Journey Research Protocol

Status: Optional — removed as a Phase 0 requirement on 2026-07-29
Accountable role if activated: Product research
Delivery effect: None; this protocol does not block Phase 0 or any later delivery unless an
accountable owner explicitly adopts a scoped study as a future gate

The former requirement for 20 recent journeys from at least 10 participants was removed by the
product owner. The remaining content is a reusable consent and data-handling protocol, not a
commitment to conduct the study or meet a participant quota.

## Participant mix

Recruit US-based English-speaking candidates across:

- Early- and mid-career experience
- Software engineering, data, and product roles
- Remote, hybrid, and on-site preferences
- At least three commonly encountered ATS families
- A mix of employed, unemployed, and actively transitioning candidates

Do not recruit based on protected characteristics. Voluntary demographic data is not needed for
this study.

## Consent and handling

Before a session, state its purpose, what is recorded, retention, withdrawal process, and that
participation does not affect product access. Record an immutable consent-document version and
timestamp outside the repository.

Never commit resumes, names, emails, employer accounts, application answers, screenshots, or raw
recordings. Store research material in an access-controlled approved system. Repository evidence
contains only de-identified journey IDs and aggregated findings.

## Journey capture template

For each recent application record:

1. Discovery source and why the job looked relevant
2. Job freshness and duplicate/stale signals
3. ATS/provider and device used
4. Steps, clicks, elapsed active time, and handoffs
5. Repeated fields and answers
6. Resume, cover-letter, and custom-answer changes
7. Uncertain, sensitive, login, MFA, or CAPTCHA steps
8. Corrections made before submission
9. Confirmation evidence and ambiguous-submit behavior
10. Trust concerns and the minimum review the participant would accept

Do not ask what happened after submission.

## Evidence if a future study is activated

- Participant screener and consent text approved
- A study-specific sample and stopping rule approved by its accountable owner
- Findings grouped by ATS, field type, device, and candidate segment
- Top failure modes mapped to architecture requirements and evaluation fixtures
- Product owner signs the synthesis and records changes in the delivery work log
