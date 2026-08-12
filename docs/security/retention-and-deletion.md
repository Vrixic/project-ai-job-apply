# Retention and Deletion Specification

- Status: Provisional engineering defaults; product and counsel approval pending
- Last updated: 2026-08-11

All durations are configuration, not hard-coded policy.

| Data | Provisional retention |
|---|---|
| Active account/profile/preferences | Until user deletion |
| Private source resumes and normalized documents | User controlled; provisional default until document or account deletion |
| Deleted account | No recovery after confirmation; active access ends immediately |
| Generated application artifacts | User controlled; default until account deletion |
| Raw contributed-page quarantine | Maximum 30 days |
| Approved sanitized fixture | While required for regression and permission remains valid |
| Detailed application/workflow logs | 30 days, redacted |
| Security/audit events | 365 days, access controlled |
| Product analytics | 13 months, de-identified/aggregated where possible |
| RDS point-in-time backups | 35 days |
| OAuth tokens | Revoke and delete immediately on disconnect or account deletion |

No provisional duration is an approved public promise. Counsel must confirm applicable legal holds,
consumer-rights response periods, contractual requirements, and jurisdictional exceptions before
real candidate data is collected.

## Current synthetic-environment enforcement

The provisional product schedule above is intentionally separate from the deployed Phase 0
engineering settings. At the reviewed source baseline:

| Foundation store | Enforced setting or state | Approval significance |
|---|---|---|
| CloudWatch application logs | 30-day Terraform retention | Matches the provisional detailed-log value for synthetic foundation telemetry only |
| Lambda durable execution history | 30-day bounded history; PostgreSQL remains product truth | Operational execution history, not candidate audit-retention evidence |
| RDS automated backups/PITR | Seven days in development; synthetic staging has the same setting only while active | Tested prelaunch recovery setting; not the provisional 35-day public backup policy |
| SQS work queue / DLQ | 14 days / 4 days | Identifier-only transport retention; not product-record retention |
| Security/audit record store | No separate 365-day product audit store is implemented | Blocks any claim that the provisional public audit schedule is enforced |
| Product analytics | Optional product analytics is not active | No Phase 0 analytics-retention approval is implied |
| Export and account-deletion workflow | Not implemented end to end | Blocks real candidate onboarding until implemented, deployed, and tested |
| Candidate-document quarantine | Separate KMS bucket and scan plan are locally defined but not deployed; deletion/reconciliation is unimplemented | Blocks real resume upload and any retention-enforcement claim |

Shared environments remain synthetic-only, so the seven-day backup setting does not shorten a
public promise or authorize real-data processing. Before real candidate onboarding, reviewers must
approve one coherent schedule and engineering must prove that configured stores, restores,
deletion-ledger replay, audit retention, provider reconciliation, and public disclosures match it.
Configuration drift from an approved schedule is a release-blocking finding.

The deletion workflow must:

1. Revoke identity sessions, OAuth connections, and delegated credentials.
2. Prevent new workflows and external side effects.
3. Delete owned database rows and encrypted objects.
4. Remove search, cache, analytics, and support-system copies.
5. Send deletion requests to applicable subprocessors and reconcile completion.
6. Retain only legally required or minimal non-PII integrity tombstones.
7. Record completion without retaining deleted values.

Backups are not selectively rewritten. Deleted data becomes inaccessible in active systems
immediately and ages out through the documented backup window; a restore must replay the deletion
ledger before serving traffic.

## Correction and export

- Candidates can view and correct confirmed profile facts without silently rewriting prior
  application packets.
- Corrections create new versions and invalidate pending packets that used materially changed data.
- An authenticated export is generated through a durable workflow and contains owned profile,
  preference, document/application metadata, consent, and relevant audit history in a documented,
  portable format.
- Restricted secrets and credential material are never exported; connected-account metadata may be
  included without tokens.
- Export artifacts are encrypted, short-lived, single-user authorized, access-audited, and deleted
  after the configured download window.
- Identity verification, response periods, appeal/escalation, and any lawful exclusions require
  counsel approval.

## Deletion states

1. `requested` — authenticate the request and clearly disclose irreversible effects.
2. `quarantined` — block login, new workflows, external effects, and ordinary access.
3. `active-systems-deleted` — delete or irreversibly detach primary records, objects, caches,
   indexes, and optional analytics.
4. `subprocessors-pending` — reconcile required provider deletion acknowledgements.
5. `completed` — retain only the allowed non-PII completion proof and expiring backup ledger.
6. `backup-expired` — all ordinary backup windows that could contain the deleted data have elapsed.

Confirmed deletion cannot be reversed. Before confirmation, the product provides a clear warning
and an opportunity to export data or cancel the request. Inaccessible backup copies age out within
35 days and may not be used to restore an account.

## Decisions required

| Decision | Provisional value | State |
|---|---|---|
| Deleted-account recovery | None after confirmation; active access ends immediately; backup copies age out within 35 days | Product decided; implementation and counsel/security approval required |
| Generated-artifact default | Retain until user deletes the artifact or account | Product decided; counsel/privacy approval required |
| Raw contribution quarantine | Maximum 30 days | Source/UGC counsel approval required |
| Detailed workflow logs | 30 days, redacted | Security/privacy approval required |
| Security/audit events | 365 days, access controlled | Security/privacy and counsel approval required |
| Product analytics | No optional analytics in Phase 0; later retention chosen with explicit preference design | Product decided; later purpose/consent and counsel approval required |
| Export download window and format | Not selected | Product/security/privacy decision required |
| Rights-request verification and response timing | Not selected | Counsel required |

Approval and tested evidence are recorded in the
[Phase 0 security/privacy approval plan](security-privacy-approval-plan.md).
