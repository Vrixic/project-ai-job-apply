# Phase 0 Accountable Security and Privacy Review Record

- Status: Engineering pre-audit passed; accountable disposition deferred to D6-015 under ADR-020
- Record owner: Product owner
- Security reviewer: Unassigned
- Privacy reviewer: Unassigned
- Review policy updated: 2026-08-12 for ADR-019 legal-review deferral
- Review revision: Pending immutable Git commit
- Review opened: Not started
- Review completed: Not completed
- Engineering pre-audit: Passed 2026-08-12; [objective evidence](../product/delivery/evidence/d0-security-privacy-engineering-preaudit-2026-08-12.md); reviewer disposition still pending

## Purpose and limits

This was prepared as the disposition record for removed D0-015 and is now a mandatory foundation
input to D6-015 under ADR-020. It lets the independent launch reviewer bind inherited-foundation
review to the exact candidate revision, record findings and residual-risk decisions, and avoid
implying that the engineering pre-audit was accountable approval.

Completing this record requires human judgment. Repository authors and agents may prepare evidence
and correct documentation, but must not enter reviewer identities, independence statements,
findings, acceptances, or signatures on a reviewer's behalf.

An approval here means only that the foundational design and its blocking delivery gates are
acceptable for the scope stated below. It does **not** authorize real candidate data, public users,
live ATS actions, public UGC, AI processing, outreach, billing, mobile distribution, or production
launch. Those capabilities retain their owning-delivery gates. The independent assessment and
penetration test of the exact public-launch candidate required by
[ADR-015](../adr/015-independent-prelaunch-security-review.md) remains a separate D6 gate.

## Reviewer selection and execution boundary

The product-risk owner selects named people, not organizations or automated tools alone. A
reviewer may rely on a specialist, but must name that reliance, its scope, and any evidence the
reviewer did not personally assess.

Minimum competence for the **security reviewer** is demonstrated experience assessing web/API
authentication and object/function/property authorization, OIDC session behavior, AWS serverless
and IAM/KMS/network boundaries, secure software supply chains, logging/recovery, and incident and
vulnerability-management design. The reviewer must be able to challenge both source-level claims
and the linked deployed evidence rather than accepting the evidence matrix as a checklist.

Minimum competence for the **privacy reviewer** is demonstrated experience assessing data
inventory and minimization, purpose and consent boundaries, individual-rights flows, retention and
deletion, subprocessors, telemetry, and privacy risks across product and cloud systems. Legal
conclusions remain owned by the qualified counsel completing D6-016 under ADR-019. Because that
review is deferred, the D6 privacy reviewer must identify every legal assumption they did not
assess, preserve its owning capability or launch gate, and must not independently declare legal
compliance.

The **product-risk owner** must have authority to keep capabilities blocked, fund remediation, and
accept only the residual risks this record permits. A repository author may hold that role, but
must provide their legal name and actual role and may not use product-risk acceptance to replace a
reviewer disposition or a counsel conclusion.

D6-015 combines inherited-foundation disposition with the independent exact-candidate assessment
and penetration test. Each reviewer must disclose whether they principally designed or implemented a reviewed control,
report to or are paid by a person whose decision they are reviewing, hold a material financial
interest, or have another relationship that could impair challenge. Such a reviewer must not be
described as independent. The product-risk owner must appoint an additional competent reviewer
when a disclosed conflict prevents credible review; merely recording the conflict does not cure
it. The D6 assessor remains subject to ADR-015's stricter independence requirement regardless of
the D0 reviewer selection.

Execute the review in this order:

1. Merge every intended review-package correction, then identify one full 40-character commit.
2. Confirm ADR-019's D6-016 deferral and enumerate every legal assumption that remains assigned to
   a capability-specific or public-launch gate; do not treat the deferral as approval.
3. Record reviewer identities, competence, conflicts, dates, exact scope, accessible evidence, and
   exclusions. Repository authors may supply links and factual environment labels but may not
   record that a reviewer inspected them.
4. Each reviewer inspects every applicable FR row and deployed-evidence row and records an explicit
   result. Silence, a prepared link, or an engineering `Pass` is not reviewer acceptance.
5. Record sanitized findings, owners, due dates, blocked activities, and restricted evidence
   references. Engineering remediates; the reviewer records any required retest result.
6. Reconcile privacy/security dependencies while preserving deferred legal gates, and record each
   time-bounded residual-risk decision. Keep future capability gates explicit rather than treating
   unimplemented controls as deployed.
7. The independent security/privacy reviewer and product-risk owner each enter their own traceable
   disposition bound to the same exact-candidate commit. Delivery governance may close D6-015 only afterward.

Repository evidence can pre-populate the review-package manifest, control descriptions, immutable
artifact links, environment labels, and known engineering states. Reviewer identity and
competence, conflicts, evidence-inspection results, FR dispositions, findings, retests, residual
risk acceptance, exclusions, signatures, and completion dates always require the attributable
human actor named for that field.

The 2026-08-12 [engineering pre-audit](../product/delivery/evidence/d0-security-privacy-engineering-preaudit-2026-08-12.md)
is a current objective-evidence handoff. It records dependency, authorization, infrastructure,
credential-pattern, fixture, and incremental pinned-SAST results plus the limitations that remain
blocked. Reviewers may rely on it only after inspecting its scope and must record their own
dispositions below.

## 1. Review identity and immutable scope

The record is invalid until every `Pending` field in this section is completed by or verified with
the named reviewers.

| Field | Required value |
|---|---|
| Repository commit reviewed | Pending full 40-character Git commit |
| Review package version/date | Pending |
| Security reviewer name, organization, and role | Pending |
| Security reviewer independence/conflict statement | Pending |
| Privacy reviewer name, organization, and role | Pending |
| Privacy reviewer independence/conflict statement | Pending |
| Product-risk owner legal name and role | Pending |
| Review start/end UTC dates | Pending |
| Environments/evidence inspected | Pending; identify development and synthetic-staging evidence actually inspected |
| Exclusions or inaccessible evidence | Pending; `None` only after explicit confirmation |

The reviewers must state whether they principally designed or implemented any reviewed control,
hold a financial or reporting relationship that affects independence, or relied on another
specialist. A conflict does not disappear because it is disclosed; the product-risk owner decides
whether another reviewer is required. No Phase 0 disposition may be described as independent when
the disclosed relationship does not support that claim.

## 2. Foundation scope

Review the following files at the commit recorded above. Record one disposition per row; do not
infer acceptance from silence.

Disposition vocabulary: `Approved`, `Approved with conditions`, `Changes required`, or
`Out of scope`. `Approved with conditions` requires finding IDs, owners, due/expiry dates, and a
clear statement of which activity remains blocked.

| ID | Review item | Reviewer disposition | Finding/condition IDs |
|---|---|---|---|
| FR-01 | [Product boundary and prohibited processing](../PRODUCT_AND_SYSTEM_ARCHITECTURE.md#4-scope-and-non-goals) | Pending | Pending |
| FR-02 | [Threat model](threat-model.md) | Pending | Pending |
| FR-03 | [Privacy impact assessment](privacy-impact-assessment.md) | Pending | Pending |
| FR-04 | [Data flow and classification](data-flow-and-classification.md) | Pending | Pending |
| FR-05 | [Consent model](consent-model.md) | Pending | Pending |
| FR-06 | [Retention and deletion specification](retention-and-deletion.md) | Pending | Pending |
| FR-07 | [Subprocessor activation register](subprocessors.md) | Pending | Pending |
| FR-08 | [Auth0 configuration baseline](auth0-configuration-baseline.md) and temporary synthetic-staging exception in [ADR-014](../adr/014-shared-development-auth0-for-synthetic-staging.md) | Pending | Pending |
| FR-09 | [API security and final-review baseline](api-security-and-final-review.md) and [ADR-015](../adr/015-independent-prelaunch-security-review.md) | Pending | Pending |
| FR-10 | [Incident-response runbook](../../infrastructure/runbooks/incidents/phase-0-incident-response.md) | Pending | Pending |
| FR-11 | [Vulnerability-management runbook](../../infrastructure/runbooks/security/vulnerability-management.md) and [dependency exceptions](dependency-vulnerability-exceptions.md) | Pending | Pending |
| FR-12 | [Security/privacy approval plan and control matrix](security-privacy-approval-plan.md) | Pending | Pending |
| FR-13 | Real-data, provider, external-action, public-client, and public-launch delta gates | Pending | Pending |

The D0 review may inspect later-delivery code as context, but it does not approve that capability
unless the scope is explicitly expanded through the owning delivery's review process. A later
feature cannot inherit a Phase 0 disposition merely because it uses a reviewed foundation.

## 3. Deployed evidence inspected

These records contain sanitized engineering evidence, not approval. Reviewers must record the
records actually inspected and any freshness or scope limitation.

| Evidence area | Primary record | Inspected/result |
|---|---|---|
| Phase 0 gate inventory | [Exit-review readiness](../product/delivery/evidence/d0-exit-review-readiness-2026-08-11.md) | Pending |
| Managed identity, MFA/passkeys, recovery | [Auth0 conformance](auth0-development-conformance.md) and [web MFA/passkey/recovery evidence](../product/delivery/evidence/d0-auth0-web-passkey-mfa-recovery-2026-07-30.md) | Pending |
| Owner isolation | [Development two-account denial](../product/delivery/evidence/d0-development-cross-user-isolation-2026-07-29.md) and synthetic-staging acceptance identified in the exit-readiness record | Pending |
| Encryption, secrets, network, and workload boundary | [Development persistent platform](../product/delivery/evidence/d0-development-persistent-platform-2026-07-29.md) and [provider retirement](../product/delivery/evidence/d0-development-provider-retirement-acceptance-2026-08-08.md) | Pending |
| Logging, redaction, traceability, and alert delivery | [Distributed tracing](../product/delivery/evidence/d0-development-distributed-tracing-2026-07-30.md), [provider/log recovery](../product/delivery/evidence/d0-development-provider-log-recovery-2026-07-30.md), and linked staging evidence | Pending |
| Backup/PITR and isolated restore | [Development restore](../product/delivery/evidence/d0-development-postgresql-restore-2026-07-30.md) and [synthetic-staging restore](../product/delivery/evidence/d0-staging-postgresql-restore-2026-07-31.md) | Pending |
| Durable execution, replay, rollback, and reconciliation | [Development provider-retirement acceptance](../product/delivery/evidence/d0-development-provider-retirement-acceptance-2026-08-08.md), [staging provider-retirement acceptance](../product/delivery/evidence/d0-staging-provider-retirement-acceptance-2026-08-08.md), and records linked from exit readiness | Pending |
| Supply chain and exceptions | CI/release evidence linked by the [approval plan](security-privacy-approval-plan.md) and [dependency exception register](dependency-vulnerability-exceptions.md) | Pending |

Shared Auth0 in synthetic staging is an explicit limitation, not independent identity-isolation
evidence. Staging is disposable and may be dormant when the review occurs; reviewers may rely on
the immutable activation/acceptance/shutdown evidence only if they explicitly accept its
freshness and scope.

## 4. Findings and conditions

Use stable IDs `SPF-001`, `SPF-002`, and so on. Do not put exploit details, secrets, tokens,
candidate data, or sensitive cloud identifiers in this repository. Keep restricted reproduction
material in the reviewer's controlled system and reference it opaquely.

Severity vocabulary: `Critical`, `High`, `Medium`, `Low`, `Informational`.

Disposition vocabulary:

- `Open — release blocking`
- `Open — real-data blocking`
- `Remediated — retest pending`
- `Closed — retested`
- `Risk accepted — expiring`
- `Not applicable`

| ID | Area/control | Severity | Sanitized finding or condition | Owner | Due/expiry | Disposition | Restricted evidence reference | Retest/reviewer note |
|---|---|---|---|---|---|---|---|---|
| Pending | Pending | Pending | Review not started | Pending | Pending | Pending | Pending | Pending |

Delete the placeholder only when findings are entered or the reviewers explicitly record
`No findings` in their signed dispositions. An absent row is not evidence that the review found
nothing.

## 5. Residual risks and mandatory gates

Every accepted risk must be specific, time bounded, owned, and tied to compensating controls.
Critical or High findings cannot be accepted for real-data or public operation by this foundation
record. Unresolved Medium findings require explicit security-reviewer and product-risk-owner
acceptance; lower findings still require an owner and review date.

| Risk/finding ID | Scope allowed | Scope blocked | Compensating controls | Owner | Expiry/revalidation trigger | Security reviewer acceptance | Product-risk owner acceptance |
|---|---|---|---|---|---|---|---|
| Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

The reviewers must explicitly confirm that these gates remain blocking:

- no real candidate data before approved notice/rights, deletion/export, identity, provider, and
  incident-operating evidence;
- no public UGC or representative provider fixture acquisition without authorized provenance,
  sanitization, takedown, and applicable legal/privacy conditions;
- no AI, ATS action, remote browser, outreach, billing, mobile, or extension activation without
  the owning delivery's concrete delta review;
- no real-user staging or production trust in the development Auth0 tenant; and
- no public launch without ADR-015's independent exact-candidate assessment, remediation, retest,
  staffed incident/vulnerability intake, and signed release disposition.

## 6. Reviewer dispositions

Each reviewer completes their own statement. Electronic approval must be traceable to the named
reviewer and immutable reviewed revision; a repository author must not paste an unverified
approval received informally.

### Security reviewer

- Disposition: Pending
- Scope/exclusions accepted: Pending
- Open blocking finding IDs: Pending
- Conditions and expiry: Pending
- Independence/conflict statement: Pending
- Name/organization: Pending
- Approval reference and UTC date: Pending

### Privacy reviewer

- Disposition: Pending
- Scope/exclusions accepted: Pending
- Open blocking finding IDs: Pending
- Conditions and expiry: Pending
- Independence/conflict statement: Pending
- Name/organization: Pending
- Approval reference and UTC date: Pending

### Product-risk owner

- Disposition: Pending
- Residual-risk IDs accepted: Pending
- Activities still blocked: Pending
- Legal name/role: Pending
- Approval reference and UTC date: Pending

## 7. Completion check

D6-015's inherited-foundation portion is eligible for completion only when:

- the immutable scope and every foundational-review disposition are complete;
- ADR-019's legal-review deferral is explicitly accepted for D0, every unreviewed legal assumption
  remains assigned to an enforceable capability or D6-016 gate, and no legal conclusion is claimed;
- every finding has an owner and permitted disposition, and all required retests pass;
- both accountable reviewer dispositions and the product-risk-owner disposition are traceable;
- the mandatory capability and launch gates are explicitly accepted; and
- the phase/task records are updated separately through the delivery-governance process.

Until then, this record remains engineering evidence only; preparation of this template does not
approve the foundation or change D6-015 status.
