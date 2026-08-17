# D1 local browser assurance

Run `pnpm test:d1-browser-assurance` after installing root development dependencies. The bounded
runner uses a locally installed Chrome binary, a loopback-only test server, generated-synthetic BFF
responses, direct Playwright Core assertions, and injected axe-core WCAG rules. It never downloads a
browser and leaves no server or generated bundle running after completion.

The D1-002 onboarding scenarios mount the production `FoundationForm` with generated-synthetic
responses. They exercise non-fabricated preference defaults, exact normalized preference writes,
fixed-Confidential direct facts, explicit versioned review of a resume-derived proposal, local
resume type rejection, legacy sponsorship fail-closed behavior, account-transition fencing,
keyboard focus, and automated WCAG rules. All values and document metadata are synthetic.

The catalog assurance also mounts the production `JobReportControl` and `MatchAssessmentPanel`
directly. It checks the report control's six fixed reasons, body-only request, idempotency-key reuse
after ambiguous failures, key rotation after a reason change, bounded error copy, no automatic
job/source suppression implication, and unmount fencing. The match panel checks its exact fixed
gate/reason language, explicit score/rank/eligibility/outcome nonclaim, bounded error copy,
loading announcement, and stale job-identity fencing. Both surfaces receive keyboard/focus and
automated WCAG A/AA coverage in installed Chrome.

The harness lives outside `frontend/web`, and Playwright Core plus axe-core are root development-only
tools. Neither the harness nor its dependencies belong to the production web package, pnpm
production dependency closure, or Next build output.

This automated suite is not human accessibility acceptance and does not exercise managed OIDC, a
deployed BFF/gateway, deployed security headers, assistive-technology combinations, visual
regression, mobile browsers, backend persistence, AWS document processing, provider integrations,
trigger activation, or real candidate data. It does not approve ADR-023 or satisfy legal, privacy,
security, or real-candidate-onboarding review gates.
