# Retention and Deletion Specification

- Status: Provisional engineering defaults; product and counsel approval pending
- Last updated: 2026-08-25

All durations are configuration, not hard-coded policy.

| Data | Provisional retention |
|---|---|
| Active account/profile/preferences | Until user deletion |
| Private source resumes and normalized documents | User controlled; provisional default until document or account deletion. A candidate can delete one resume: it is hidden and unusable at once, the profile suggestions from it that the candidate had not reviewed are erased at once (reviewed facts stay), and a sweep every 5 minutes then removes its stored versions and markers and the Documents row (D3-027, deployed and accepted in development 2026-09-28); account deletion also purges them (its case with a stored resume is D3-028, not yet proven deployed) ([ADR-033](../adr/033-resume-deletion-is-a-tombstone-with-a-separate-byte-purge.md)) |
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
| RDS automated backups/PITR | 35 days in development; synthetic staging remains seven days while active | Development now matches the selected generated-synthetic candidate-rights backup window; this is not a public promise or production approval |
| SQS work queue / DLQ | 4 days / 14 days | The work queue is identifier-only. The shared DLQ retains value-free schedule, terminal-metadata, durable-identifier, and failed-nudge envelopes; it has no automatic consumer/redrive and is not product-record retention. |
| Security/audit record store | No separate 365-day product audit store is implemented | Blocks any claim that the provisional public audit schedule is enforced |
| Product analytics | Optional product analytics is not active | No Phase 0 analytics-retention approval is implied |
| Export and account-deletion workflow | Complete technical vertical and owner migrations are deployed default-dark; the immutable generated-synthetic policy is selected and Stage A state `204` applies 35-day retention plus an empty tagged identity-provider secret container | Stage B, generated-synthetic lifecycle/replay evidence, provider credential/identity setup, backup-aging acceptance, and accountable public-policy review still block real candidate onboarding |
| Candidate-document source and normalized objects | Separate KMS bucket/scan plan is deployed in development; deterministic normalized storage and exact version-aware deletion/reconciliation are implemented | Deployed candidate-rights acceptance, real-resume trigger authorization, and retention approval still block real resume upload |

Shared environments remain synthetic-only, so neither environment setting is a public promise or
authority for real-data processing. Before real candidate onboarding, reviewers must
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
- Under [ADR-035](../adr/035-restricted-answer-values-in-candidate-export.md), a separately
  activated export activity may include the latest non-deleted candidate-supplied restricted
  answer, even if expired. Superseded values are omitted and deletion tombstones are metadata-only.
  This narrow portability path does not export credentials/session material or permit ordinary
  vault-value reads. It remains default-off and synthetic-only pending accountable review.
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

## D2 generated-synthetic development policy

Repository-owner direction for Phase 2 selects the immutable
[`d2-development-synthetic-v1`](policies/candidate-rights.d2-development-synthetic-v1.json)
engineering policy for the disposable development acceptance only. The original UTF-8/LF Git blob
at `aca0762` has the deployed SHA-256
`7dbde35dda7542ace2932a68cc8d28618ce14951180f9ab69025b9f511ac35cf`.
Commit `af95bd4` reformatted arrays without changing parsed policy values. The current formatted
file is therefore not byte-identical to the original digest; retain the original immutable policy
binding rather than silently replacing the deployed digest with a formatting-only hash.
It fixes a 3,600-second export artifact, 300-second exact-version download grant, 900-second
recent-MFA window, one-day defense-in-depth S3 lifecycle, and the product-decided 35-day backup
window. Its exact ordered owner inventory adds Trust to the prior D1 owners. It authorizes
generated-synthetic development evidence only. It is not a public promise,
legal approval, accountable security/privacy approval, or authority to process real candidate data.

## D3 generated-synthetic development policy

Repository-owner direction for Phase 3 selects the immutable
[`d3-development-synthetic-v1`](policies/candidate-rights.d3-development-synthetic-v1.json)
engineering policy for disposable development acceptance only. It keeps every D2 value (3,600-second
export artifact, 300-second download grant, 900-second recent-MFA window, 35-day backup window) and adds
Applications as the eighth owner after Trust. Its SHA-256,
`c47a4637cfd1f008f29147ec610d95d1f7ca9126a5242b8ff38706157a38ab6c`, is computed over the canonical
two-space JSON serialization plus a newline, which is stable under formatters and line endings.

The Applications owner exports candidate-readable technical state and packet answers (no owner
identifiers, scope keys, consent references, evidence fingerprints, or hiring outcomes) and deletes
children before parents inside the same privacy-authorized transaction. Restore replay always purges
Applications data for every deletion marker, whichever policy version recorded it.

Profile and the workflows accept exactly the D2 seven-owner inventory or this eight-owner inventory, so
the deployed D2 configuration keeps working until the D3 policy is activated. Activation is a separate,
guarded rollout (Terraform variables, the candidate-rights operators, and their acceptance evidence) that
has not been performed. The policy authorizes generated-synthetic development evidence only. It is not a
public promise, legal approval, accountable security/privacy approval, or authority to process real
candidate data. Synthetic candidates deleted before activation leave their Applications rows behind, and a
later restore replay fails closed on such orphaned rows until they are purged.

Approval and tested evidence are recorded in the
[Phase 0 security/privacy approval plan](security-privacy-approval-plan.md).

## Source-only cover-letter cleanup checkpoint (2026-10-03)

The approved private cleanup handler fences unclaimed and not-yet-issued generation authority
using the existing non-renewable Documents ledger. It does not delete candidate artifacts, set
a new retention duration, settle running effects or release the Workflows quiescence gate.
Pending or ambiguous writers/provider work retain SQL reservation and object inventory even when
admission expires or no object is visible. A `ledger_terminal` receipt is not trusted remote-stop
proof. Production failed-call stopping evidence, transient-retention enforcement, authenticated
maintenance composition and marker-creation IAM still require implementation and reviewed rollout.
The source boundary stays default-off; existing account-deletion/public behavior is unchanged.

Source-only D3-043 now distinguishes original fulfilled provider completion followed by JSON/output
rejection from a failed or ambiguous provider port. The trusted original actor can request permanent
phase fencing before settling that completed provider phase, without writing rejected text or
granting finalization. Quarantine may drain this original completed work; errors, aborts, timeouts
and lost acknowledgements cannot certify completion. SQL terminal state still does not authorize
artifact purge or satisfy production privacy quiescence. Retention durations, deletion behavior,
public policy and deployment are unchanged; runtime/IAM and transient-retention proof remain open.

Source-only D3-045 adds known-reference background response stopping/disposal transport after
the owner separately approved the temporary provider-state tradeoff. OpenAI documents roughly
ten minutes of polling state even with `store:false`; this is not an exact retention deadline.
Only positive original-id/time/model-bound terminal acknowledgement permits response DELETE,
and only its exact positive deletion acknowledgement yields a metadata-only receipt. Missing
ids, provider 404, malformed/lost/late acknowledgements and local deadlines remain unresolved.
This port cannot create responses, settle private writers or release platform object/row purge.
Durable original response/work capture and maintained disposal reconciliation remain unfinished;
the source is uncomposed/default-off. Provider response deletion is not deletion of abuse-monitoring,
legal/safety or caching copies. Public policy, real-data scope and deployed settings are unchanged.

Source-only D3-046 adds Documents-owned original response inventory, not provider content.
One row is reserved before original creation and cannot grant another dispatch on replay.
Unknown creation identities and absent disposal ACKs remain inventoried indefinitely until
trusted positive resolution; they cannot be removed through TTL, local timeout or provider 404.
Positive exact-reference response disposal is recorded separately from private-work settlement.
Cascade deletion requires acknowledged response disposal and the existing private-work/document
deletion conditions. This does not choose a new public retention period, certify removal of other
provider copies or release platform purge. Actor capture, reconciliation, runtime/IAM and deployed
acceptance remain unfinished/default-off; no model/cloud call or activation occurs.
