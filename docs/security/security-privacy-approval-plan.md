# Phase 0 Security and Privacy Approval Plan

- Status: Review package in progress; no approval recorded
- Last updated: 2026-07-30
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

## Foundational control evidence matrix

| ID | Control area | Required evidence | Current evidence | State |
|---|---|---|---|---|
| SP-01 | Product and data boundary | Approved scope and prohibited-use rules | Architecture and repository instructions | Engineering baseline |
| SP-02 | Threat/risk management | Trust boundaries, abuse cases, owners, treatment, reassessment triggers | [Threat model](threat-model.md) | Review ready |
| SP-03 | Privacy risk management | Processing inventory, necessity, risks, rights, decisions, delta triggers | [Privacy impact assessment](privacy-impact-assessment.md) | Review ready |
| SP-04 | Data flow/classification | Stores, recipients, classes, forbidden destinations, owners | [Data flow and classification](data-flow-and-classification.md) | Engineering baseline |
| SP-05 | Consent/authorization | Versioned purposes, revocation, packet binding, sensitive-action policy | [Consent model](consent-model.md) | Engineering baseline |
| SP-06 | Retention/rights/deletion | Approved schedule, export schema, deletion workflow, backup behavior | [Retention and deletion](retention-and-deletion.md) | Decisions and approval pending |
| SP-07 | Identity/session security | Managed OIDC configuration, MFA/passkey policy, revocation, client conformance | Auth0 baseline plus [web passkey/MFA/recovery conformance](../product/delivery/evidence/d0-auth0-web-passkey-mfa-recovery-2026-07-30.md), renewal/revocation, account lifecycle, deployed owner-isolation evidence, and the provider/log recovery preflight | Development web conformance passes; the provider/log exercise is implemented but not deployed, while launch step-up policy, public-client matrices, and accountable approval remain pending |
| SP-08 | Ownership/authorization | Owner-scoped repository queries and cross-user denial tests | Profile slice tests plus [deployed two-account denial](../product/delivery/evidence/d0-development-cross-user-isolation-2026-07-29.md) | Deployed development evidence; accountable approval pending |
| SP-09 | Secrets/encryption | Secrets-manager/KMS design, TLS, rotation, no plaintext credentials | [Persistent KMS/stores](../product/delivery/evidence/d0-development-persistent-platform-2026-07-29.md), [managed Temporal secret conformance](../product/delivery/evidence/d0-development-temporal-secret-2026-07-29.md), and [overlap-safe deployed rotation](../product/delivery/evidence/d0-development-temporal-secret-rotation-2026-07-30.md) | Managed value, provider TLS/read, deployed task use, workflow completion, prior-key revocation/deletion, and rotation pass; provider permission/expiry review and accountable approval remain pending |
| SP-10 | Logging/observability | Allowlisted telemetry, redaction tests, access/retention, traceability | Local trace-context/redaction tests, [encrypted log groups and baseline alarms](../product/delivery/evidence/d0-development-persistent-platform-2026-07-29.md), [deployed alert delivery](../product/delivery/evidence/d0-development-alert-delivery-2026-07-29.md), [deployed distributed tracing](../product/delivery/evidence/d0-development-distributed-tracing-2026-07-30.md), and the provider/log recovery preflight | Development alert delivery and populated cross-service trace/redaction evidence pass; continuous heartbeats and recovery tooling are implemented but not deployed, and accountable approval remains pending |
| SP-11 | Durable external effects | Outbox, idempotency, replay safety, cancellation, immutable approval | Foundation outbox/workflow; later packet design | Partial local evidence |
| SP-12 | Secure development/supply chain | Pinned dependencies, scanning, protected deploy identity, SBOM/artifact provenance | CI, pinned Semgrep SAST, full-lockfile audit, Dependabot, Terraform workflow | Local/repository evidence; policy review pending |
| SP-13 | Availability/recovery | Isolation, backup, restore, RTO/RPO, restore test | [Private RDS with seven-day backups/PITR and a live restore point](../product/delivery/evidence/d0-development-persistent-platform-2026-07-29.md), [deployed immutable bad-image rollback](../product/delivery/evidence/d0-development-bad-image-rollback-2026-07-30.md), and [isolated PostgreSQL restore with observed development measurements](../product/delivery/evidence/d0-development-postgresql-restore-2026-07-30.md) | Development application rollback and isolated database restore pass; accountable production recovery objectives and approval remain pending |
| SP-14 | Incident response | Severity, containment, evidence, notification decision, exercises | Baseline below | Exercise and owner pending |
| SP-15 | Vulnerability management | Intake, severity, remediation ownership, disclosure path | Baseline below | Owner and operating evidence pending |
| SP-16 | Subprocessor governance | DPA/security/retention/training/region/breach/deletion review | [Subprocessor register](subprocessors.md) | Provider reviews pending |
| SP-17 | Legal/privacy foundation | Scoped written counsel conclusions and conditions | [Legal/privacy brief](../product/foundation/foundational-legal-privacy-brief.md) | Counsel pending |

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

- LP-D01 through LP-D05 in the legal/privacy brief are resolved or explicitly accepted as
  pre-production conditions by the accountable reviewers.
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
| New country/provider/ATS | Legal/privacy/security delta plus isolated release and rollback evidence |

Before entity formation, an ATS form action/submission may run only as the narrow founder-only pilot
defined by [ADR-011](../adr/011-staged-preproduction-data-and-founder-pilot.md). The exact
adapter/variant needs a written, expiring release record; no general or inherited pilot approval is
allowed.

## Approval record

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
