# Phase 0 Security and Privacy Approval Plan

- Status: Review package ready; accountable review not started
- Last updated: 2026-08-11
- Accountable security approver: Future independent reviewer; individual unassigned
- Accountable privacy/legal approver: Future external counsel; individual unassigned

## Approval boundary

Phase 0 approval establishes the controls and release gates on which later work may rely. It does
not certify unimplemented features or deployed environments.

In scope now:

- product/data boundary and prohibited processing;
- threat model and privacy impact assessment;
- data inventory, ownership, classification, and flow;
- consent and candidate-authorization design;
- retention, export, correction, deletion, and backup-aging design;
- authentication, authorization, secrets, encryption, and telemetry design;
- secure development, dependency, infrastructure, incident, and vulnerability-management design;
- subprocessor activation requirements; and
- enforceable gates for future capabilities and real data.

Later approvals must verify the concrete implementation and deployed evidence for public ingestion,
UGC, extension permissions, AI processing, ATS automation, remote browsers, outreach, billing,
mobile apps, and each new provider or jurisdiction.

Phase 0 approval must accept the blocking final-review policy in
[ADR-015](../adr/015-independent-prelaunch-security-review.md), but it cannot substitute for the
independent assessment of the exact D6 launch candidate.

## Approval roles

| Role | Accountability | Assignee |
|---|---|---|
| Product owner | Confirms product facts, risk tolerance, and residual-risk acceptance | Founder/repository owner; legal name pending |
| Security reviewer | Reviews threats, control design, test evidence, and deployed residual risk | Future independent reviewer; unassigned |
| Privacy/legal reviewer | Confirms legal/privacy requirements and review conditions | Future external counsel; unassigned |
| Platform engineering | Implements controls and supplies environment evidence | Platform engineering |
| Service/data owner | Proves ownership, authorization, minimization, and deletion behavior | Assigned per delivery |

One person may hold multiple roles in early development, but production approval must name the
actual accountable individual. Repository authorship alone is not independent security or legal
approval.

## Review procedure and evidence rules

The named reviewers complete the
[Phase 0 accountable review record](phase-0-accountable-review-record.md). That record binds the
review to one immutable Git commit, captures independence or conflicts, requires an explicit
disposition for every foundational document, and maintains sanitized finding, residual-risk,
retest, and sign-off records.

Reviewers must distinguish these evidence states:

- `Implemented` means the control exists in source or infrastructure at the reviewed revision.
- `Locally verified` means a repository check passed outside a shared deployed environment.
- `Deployed evidence` means the linked sanitized record proves the stated behavior in the named
  environment and at the stated time.
- `Review ready` means the package contains enough information for accountable judgment.
- `Approved` and `Approved with conditions` may be entered only by the named accountable reviewer.

Synthetic evidence never proves real-data handling, the temporary shared Auth0 issuer never proves
staging identity isolation, and a Phase 0 control does not approve a later capability merely
because that capability reuses it. Reviewers record freshness limits and inaccessible evidence;
silence is not approval.

## Foundational control evidence matrix

| ID | Control area | Required evidence | Current evidence | State |
|---|---|---|---|---|
| SP-01 | Product and data boundary | Approved scope and prohibited-use rules | [Architecture scope](../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#4-scope-and-non-goals) and repository instructions | Engineering baseline; accountable disposition pending |
| SP-02 | Threat/risk management | Trust boundaries, abuse cases, owners, treatment, reassessment triggers | [Threat model](threat-model.md) | Review ready |
| SP-03 | Privacy risk management | Processing inventory, necessity, risks, rights, decisions, delta triggers | [Privacy impact assessment](privacy-impact-assessment.md) | Review ready; accountable disposition pending |
| SP-04 | Data flow/classification | Stores, recipients, classes, forbidden destinations, owners | [Data flow and classification](data-flow-and-classification.md), including explicit unimplemented export/deletion flows | Engineering baseline; accountable disposition pending |
| SP-05 | Consent/authorization | Versioned purposes, revocation, packet binding, sensitive-action policy | [Consent model](consent-model.md) | Engineering baseline; implementation and capability approvals remain owning-delivery gates |
| SP-06 | Retention/rights/deletion | Approved schedule, export schema, deletion workflow, backup behavior | [Retention and deletion](retention-and-deletion.md) | Provisional policy separated from deployed synthetic settings; public durations, rights implementation, and accountable disposition pending |
| SP-07 | Identity/session security | Managed OIDC configuration, MFA/passkey policy, revocation, client conformance | Auth0 baseline plus [web passkey/MFA/recovery conformance](../product/delivery/evidence/d0-auth0-web-passkey-mfa-recovery-2026-07-30.md), renewal/revocation, account lifecycle, deployed owner-isolation evidence, and [deployed provider/log recovery](../product/delivery/evidence/d0-development-provider-log-recovery-2026-07-30.md) | Development web conformance, including provider interruption/recovery, passes. Synthetic staging temporarily shares the exact development issuer under ADR-014 and therefore does not prove identity isolation; dedicated staging/production tenants, cutover/replay, launch step-up policy, owning-delivery public-client matrices, and accountable approval remain blocking release gates. |
| SP-08 | Ownership/authorization | Owner-scoped repository queries and cross-user denial tests | Profile slice tests, [deployed development two-account denial](../product/delivery/evidence/d0-development-cross-user-isolation-2026-07-29.md), and synthetic-staging acceptance linked by the [exit-readiness inventory](../product/delivery/evidence/d0-exit-review-readiness-2026-08-11.md) | Deployed development and synthetic-staging evidence; accountable approval pending |
| SP-09 | Secrets/encryption | Secrets-manager/KMS design, TLS, rotation, no plaintext credentials | [Persistent KMS/stores](../product/delivery/evidence/d0-development-persistent-platform-2026-07-29.md), historical provider-secret rotation evidence, and [development provider retirement](../product/delivery/evidence/d0-development-provider-retirement-acceptance-2026-08-08.md) | Environment KMS/TLS and managed-secret boundaries pass; retired provider keys are revoked and secret containers are absent or in recovery-window deletion. Accountable launch approval remains pending. |
| SP-10 | Logging/observability | Allowlisted telemetry, redaction tests, access/retention, traceability | Local trace-context/redaction tests, encrypted Lambda log groups, routed serverless alarms, alert-delivery exercises, aggregate workload evidence, and privacy-safe distributed tracing | API Gateway/Lambda, durable execution, queue/DLQ, database, alert routing, and redaction evidence pass in development and synthetic staging; accountable approval remains pending. |
| SP-11 | Durable external effects | Outbox, idempotency, replay safety, cancellation, immutable approval | Deployed owner-scoped outbox/SQS/Lambda durable workflow with idempotent replay, terminal recovery, fixed workloads, rollback/restoration, and empty-work reconciliation in both environments; application-packet approval remains an owning-delivery gate | Foundation durable-execution evidence passes; irreversible submission controls are not implemented and remain later release gates |
| SP-12 | Secure development/supply chain | Pinned dependencies, scanning, protected deploy identity, SBOM/artifact provenance | CI, pinned Semgrep SAST, full-lockfile audit, Dependabot, Terraform workflow, immutable ZIP/SBOM/checksum publication, source-attested release checks, and [exact dependency exception register](dependency-vulnerability-exceptions.md) | Repository and deployed-artifact evidence pass; two expiring mobile-build CVE exceptions and accountable policy review remain pending |
| SP-13 | Availability/recovery | Isolation, backup, restore, RTO/RPO, restore test | [Private RDS with seven-day backups/PITR and a live restore point](../product/delivery/evidence/d0-development-persistent-platform-2026-07-29.md), [deployed immutable bad-image rollback](../product/delivery/evidence/d0-development-bad-image-rollback-2026-07-30.md), [development restore](../product/delivery/evidence/d0-development-postgresql-restore-2026-07-30.md), and [synthetic-staging restore](../product/delivery/evidence/d0-staging-postgresql-restore-2026-07-31.md) | Both foundation restore exercises pass with measured results; launch RTO/RPO, real-data recovery, and accountable approval remain pending |
| SP-14 | Incident response | Severity, containment, evidence, notification decision, exercises | Baseline below plus the [Phase 0 incident-response runbook](../../infrastructure/runbooks/incidents/phase-0-incident-response.md) and component recovery/revocation/isolation evidence | Procedure is review ready; named incident/privacy roles, monitored channels, and a staffed exercise remain pending |
| SP-15 | Vulnerability management | Intake, severity, remediation ownership, disclosure path | Baseline below, the [vulnerability-management runbook](../../infrastructure/runbooks/security/vulnerability-management.md), full-lockfile audit, and exact expiring exception register | Procedure and repository enforcement are review ready; accountable owner/reviewer, monitored external contact, response objectives, and operating-cycle evidence remain pending |
| SP-16 | Subprocessor governance | DPA/security/retention/training/region/breach/deletion review | [Subprocessor register](subprocessors.md) | Provider reviews pending |
| SP-17 | Legal/privacy foundation | Scoped written counsel conclusions and conditions | [Legal/privacy brief](../product/foundation/foundational-legal-privacy-brief.md) | Counsel pending |
| SP-18 | API and final product assurance | Explicit exposure classes, API control baseline, independent launch-candidate assessment, remediation and retest | [API security and final-review baseline](api-security-and-final-review.md), [ADR-015](../adr/015-independent-prelaunch-security-review.md) | Baseline defined; exact launch-candidate evidence belongs to D6 |
| SP-19 | Accountable disposition | Immutable reviewed revision, conflict disclosures, per-document decisions, finding treatment, residual-risk expiry, and signatures | [Phase 0 accountable review record](phase-0-accountable-review-record.md) | Template ready; reviewers and all dispositions pending |

`Engineering baseline` and `Review ready` are not approval states.

## Incident-response baseline

Before real candidate data is processed:

1. Name an incident commander and privacy/legal escalation contact.
2. Provide a monitored internal reporting channel and an external security-reporting channel.
3. Classify events by candidate harm, confidentiality, integrity, availability, and irreversible
   external-action impact.
4. Preserve sanitized evidence and an immutable timeline without copying candidate values into
   incident tools unnecessarily.
5. Contain with credential/session revocation, provider/adapter kill switches, queue pausing,
   network isolation, and deployment rollback.
6. Determine notification duties with counsel based on affected people, data, jurisdictions,
   contracts, and timing.
7. Reconcile workflows, submissions, deletions, providers, and backups before recovery is declared.
8. Record root cause, corrective actions, owners, evidence, and control revalidation.
9. Exercise account takeover, cross-user disclosure, secret leakage, and unintended submission
   scenarios before production.

## Vulnerability-management baseline

- Accept reports through a published security contact before public launch.
- Triage by exploitability and candidate impact, including privacy and unintended-action impact.
- Immediately disable a provider/adapter when safe operation cannot be demonstrated.
- Track remediation and regression evidence without publishing sensitive exploit details.
- Patch supported dependencies and images through reviewed, reproducible builds.
- Define severity-based response objectives before production and review exceptions explicitly.
- Do not claim a vulnerability disclosure program or response objective until it is staffed and
  monitored.

## Phase 0 approval conditions

Approval requires all of the following:

- D0-014's accountable legal/privacy conclusions are linked, and every security/privacy dependency
  from those conclusions is resolved or recorded as a blocking, owned condition.
- The accountable product, security, and privacy/legal reviewers are named.
- Every foundational document has a version/commit and an explicit reviewer disposition.
- Security/privacy findings have owners and are closed, conditionally accepted, or recorded as
  release-blocking.
- Real-data, external-action, and public-release gates are accepted.
- No repository author self-certifies counsel or independent security approval.

Cloud restore, penetration-test, and feature-specific evidence may remain later gates when the
corresponding environment or capability does not yet exist. They may not be represented as passed.

## Feature delta-approval gates

| Capability | Minimum delta evidence before activation |
|---|---|
| Real candidate onboarding | Privacy notice/rights implementation, managed identity, access tests, deletion/export test, deployed controls |
| Job-source ingestion | Source-specific written permission/conditions, provenance, rate/freshness/takedown controls |
| Public UGC | Contribution license/consent, moderation/takedown operation, contributor privacy tests |
| Browser extension | Manifest/permission review, active-tab data-flow test, disclosure/store approval, remote disable |
| AI tailoring | Provider review, minimum-data prompts, retention/training settings, prompt-injection/factuality evaluation |
| ATS form action/submission | Site/ATS review, immutable approval, sensitive-field policy, duplicate/ambiguous-submit tests |
| Remote browser | Dedicated threat model, isolation/egress/session destruction, takeover and incident tests |
| Outreach | Source/anti-spam review, send-only scopes, per-send approval, suppression/complaint controls |
| Billing/mobile | Provider/store review, entitlement replay, privacy labels, account deletion, secure storage |
| Public launch candidate | Complete owned attack-surface inventory; independent web/API, mobile, extension, application-agent, cloud, supply-chain, abuse, recovery, and incident assessment; no unresolved Critical/High finding; retest and signed exact-release disposition |
| New country/provider/ATS | Legal/privacy/security delta plus isolated release and rollback evidence |

Before entity formation, an ATS form action/submission may run only as the narrow founder-only pilot
defined by [ADR-011](../adr/011-staged-preproduction-data-and-founder-pilot.md). The exact
adapter/variant needs a written, expiring release record; no general or inherited pilot approval is
allowed.

## Approval record

The authoritative finding, residual-risk, and sign-off fields live in the
[accountable review record](phase-0-accountable-review-record.md). This summary stays pending until
that record is complete and its exact revision is linked here.

| Field | Value |
|---|---|
| Commit/artifact versions reviewed | Pending |
| Product owner and disposition | Pending |
| Security reviewer and disposition | Pending |
| Privacy/legal reviewer and disposition | Pending |
| Open release-blocking findings | Pending |
| Accepted residual risks and expiry | None |
| Approval date | Not approved |
| Mandatory revalidation date/triggers | Pending |
