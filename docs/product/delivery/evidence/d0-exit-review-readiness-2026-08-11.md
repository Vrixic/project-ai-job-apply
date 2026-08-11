# D0 Exit-Review Readiness — 2026-08-11

## Disposition

All repository-controlled Phase 0 implementation is complete. D0-008 and D0-016 now pass after
stable repeated two-account post-retirement cost reads. The staging on-demand lifecycle has passed
activation, acceptance, and return to dormancy; only its first complete posted dormant UTC day is
time-dependent.

Phase 0 cannot be marked complete because accountable legal/privacy and security/privacy reviewers
remain unassigned, representative provider fixtures cannot be acquired before those dispositions,
and the first complete dormant day has not posted yet. Repository authors have not substituted
internal implementation evidence for external approval.

## Repository verification

The complete local `scripts/verify-phase0.ps1` sequence passed after the updates. It regenerated
contracts and passed all seven repository-skill checks, steady-state serverless infrastructure
policy, formatting, lint, type checking, unit/API tests, production builds, Compose validation, and
the prohibited coaching/post-submission scope scan.

## Exit-criterion audit

| Criterion | State | Evidence or remaining gate |
|---|---|---|
| US launch segment and provisional presentation identity | Pass | Product-owner decisions and the swappable ApplyDash brand contract are recorded; final public naming remains D6. |
| Foundational legal/privacy assumptions | Blocked | The bounded brief/register are review ready; accountable counsel is unassigned. |
| Core schemas and ownership boundaries | Pass | Versioned OpenAPI, domain, event, consent, and persistence contracts pass compatibility checks. |
| Foundational security/privacy controls | Blocked | The complete review package and deployed evidence matrix are review ready; accountable reviewers are unassigned. |
| Repository, CI, cloud, secrets, observability, and restore foundation | Pass | Development and on-demand synthetic staging pass authenticated foundation, alerting, restore, workload, rollback, and zero-drift gates. |
| Sanitized representative ATS fixtures | Blocked | Policy and synthetic fixtures exist; representative acquisition awaits accountable legal/privacy and security disposition. |
| Quality, reliability, safety, efficiency, and cost definitions | Pass | Workload/AWS evidence, exact controls, CUR delivery, attribution, and stable post-retirement daily reads pass with zero ECS/Fargate cost. |
| Authenticated client-to-durable-result slice | Pass | Both environments pass persistence, durable readiness, idempotent replay, cross-user denial, aggregate workload, and recovery checks. |
| Scale-to-zero runtime with obsolete path removed | Pass | D0-016 is complete; the retired ECS/Temporal runtime and executable repository paths are absent. |
| On-demand synthetic staging | Pending posted evidence | Full activation/reacceptance/return passes and live state is dormant; run the complete-day dormant usage verifier after AWS posts August 11. |
| Prohibited product scope | Pass | Architecture and repository instructions exclude coaching, inbox/calendar reading, and post-submission hiring outcomes. |

## Remaining gates

1. **Dormant staging cost observation:** after AWS posts the complete `2026-08-11` UTC day, run the
   explicit verifier and require zero RDS instance-hours and zero VPC endpoint-hours. Retained
   control-plane cost may remain nonzero.
2. **Accountable legal/privacy review:** assign counsel, review LR-F01 through LR-F07, and record
   scoped conclusions, conditions, versions, reviewer, and date.
3. **Accountable security/privacy review:** name reviewers, complete the evidence-matrix review,
   record findings/owners/expiry, and issue a disposition without treating repository authorship as
   independent approval.
4. **Representative ATS fixture approval and acquisition:** after the preceding dispositions,
   acquire the initial approved provider-family fixtures through provenance, quarantine,
   sanitization, scanning, human review, checksum, and retention controls.
5. **Exit review:** once the four gates above pass, complete D0-007, D0-012, D0-014, D0-015, and
   D0-017; rerun repository verification and synchronize the master tracker.

## Dormant cost command

Run only after the complete day has posted under a refreshed staging session:

```powershell
.\scripts\inspect-phase0-cost.ps1 -Environment staging `
  -StartDate 2026-08-11 -EndDate 2026-08-12 `
  -VerifyDormantStaging
```

The inspector is read-only, account scoped, aggregate only, and fail closed. Cost Explorer API
requests are billable. Retain no account identifier, resource identifier, object key, raw CUR row,
credential, or destination.

The operator was exercised against the known August 10 transition day. It detected 20.2028 RDS
instance-hours and 61 VPC endpoint-hours and rejected the interval as non-dormant, validating the
service/usage-type matching and failure boundary without changing AWS state.

## Review package

- [Phase 0 task register](../phase-0-foundation.md)
- [Completed scale-to-zero migration](../phase-0-serverless-runtime-migration.md)
- [Staging on-demand lifecycle](../phase-0-staging-on-demand-runtime.md)
- [Post-retirement cost acceptance](d0-post-retirement-cost-acceptance-2026-08-11.md)
- [Security/privacy approval plan](../../../security/security-privacy-approval-plan.md)
- [Foundational legal/privacy brief](../../foundation/foundational-legal-privacy-brief.md)
- [ATS fixture policy](../../foundation/ats-fixture-policy.md)

This record is an internal readiness and gap audit. It is not legal advice, security/privacy
approval, representative-source permission, independent penetration-test evidence, or Phase 0
completion.
