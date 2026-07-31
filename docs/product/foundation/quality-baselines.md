# Phase 0 Quality and Reliability Baselines

Status: Definitions and fixed staging workload preflight implemented; execution pending D0-011
Accountable roles: Product analytics, QA/automation, and platform engineering

## Product-quality measurements

| Measurement | Definition | Phase 0 evidence |
|---|---|---|
| Preference correction rate | Saved preference fields changed during the same review | Synthetic harness only |
| Review-ready packet factuality | Unsupported candidate claims divided by generated claims | Defined for later packet evaluations |
| Field accuracy | Correct deterministic field mappings divided by attempted mappings | Defined for ATS fixtures |
| Duplicate external actions | Duplicate sends/submissions for one idempotency identity | Must remain zero |
| Confirmed-application active time | Active interaction time through confirmation | Exercise with synthetic scripted journeys in D0; establish real-user distributions only after relevant product usage exists |
| Confirmation ambiguity | Attempts without reliable success/failure evidence | Defined for later adapter fixtures |
| Cost per review-ready packet | Provider and compute cost attributed to one ready packet | Instrumentation contract defined |

Volume is never a success metric when relevance, factuality, correction, consent, duplicate, or
confirmation guardrails fail.

## Initial service objectives

- Authenticated reads: 99.9% monthly Platform availability
- Profile/application writes: 99.95% monthly Platform availability
- Approved application-state durability: 99.99%
- Workflow update propagation: 99% within 60 seconds
- Transactional RPO: 5 minutes
- Core API RTO: 60 minutes
- Cross-user authorization failures, leaked secrets/PII, fabricated facts, and duplicate
  irreversible actions: zero tolerated

Third-party ATS failures are measured separately from Platform failures.

## Reproducible evidence

The Phase 0 verification command generates contracts and runs formatting, linting, type checking,
unit tests, builds, Compose validation, and removed-scope checks. Before D0 closes, staging must
also record API/load results, workflow-restart results, backup restoration, trace propagation, and
cost attribution using only synthetic data.

The fixed `phase0_staging_foundation_v1` profile prepares the remaining API/load evidence without
claiming production capacity: 200 liveness reads, 200 readiness/database reads, 100 expected
protected `401` reads, 25 sequential durable preference/outbox/Temporal workflows, and one exact
idempotent replay. Its browser response and AWS corroboration retain only counts, timestamps,
booleans, aggregate latency/utilization, and forbidden/error matches. Execution remains pending.
