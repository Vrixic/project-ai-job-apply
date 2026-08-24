# D1 Source and Real-Candidate Onboarding Disposition Worksheet

- Status: Provider counsel rows superseded by ADR-025; LR-D1-04 template remains open
- Prepared: 2026-08-16
- Related brief: [D1 source and onboarding review brief](d1-source-and-onboarding-review-brief.md)
- LR-D1-01 state: `Removed` by ADR-025; no legal approval claimed
- LR-D1-02 state: `Removed` by ADR-025; no legal approval claimed
- LR-D1-03 state: `Removed` by ADR-025; no legal approval claimed
- LR-D1-04 state: `Not started`

ADR-025 supersedes this worksheet as the activation authority for LR-D1-01 through LR-D1-03. Their
questions remain a risk reference for exact product/source-engineering activation records, but no
counsel signature or legal conclusion is required or claimed for those three bounded public GET
adapters. This worksheet becomes a real-candidate review record only when accountable reviewers
complete LR-D1-04 against one immutable candidate and provide attributable records.

## Disposition vocabulary

- `Not started` — no accountable review has begun; the release consequence remains active.
- `Not reviewed` — an exact package may have been routed to a named reviewer, but no attributable
  conclusion exists; this is not approval and does not relax a gate.
- `Approved` — the named accountable reviewer permits only the exact recorded scope and every
  prerequisite is closed.
- `Approved with conditions` — no activation until every release-blocking condition is accepted as
  closed; any continuing condition must state its scope and revalidation/expiry.
- `Rejected` — the capability remains disabled; record the reason and any eligible resubmission.

Product-owner acknowledgement cannot substitute for counsel, provider permission, or independent
security/privacy review. Silence, a repository merge, public documentation, a successful HTTP
response, or synthetic test evidence is never approval.

## Immutable review candidate

| Field | Value |
|---|---|
| Repository commit reviewed | Pending |
| Commit tree | Pending |
| Artifact manifest algorithm | UTF-8 relative path, LF-normalized bytes, ordinal path ordering, SHA-256; pending freeze |
| Artifact manifest SHA-256 | Pending |
| Deployment/environment candidate | None; source documentation only |
| Review opened at (UTC) | Pending |
| Review closed at (UTC) | Pending |

### Required packet artifacts

| Artifact | Required review state |
|---|---|
| `docs/product/foundation/d1-source-and-onboarding-review-brief.md` | Pending exact-commit review |
| `docs/product/foundation/d1-source-and-onboarding-review-disposition.md` | This worksheet; incomplete |
| `docs/product/foundation/legal-review-register.md` | Current authoritative states must still read `Not started` |
| `docs/security/privacy-impact-assessment.md` | Pending D1 delta review |
| `docs/security/data-flow-and-classification.md` | Pending D1 source/onboarding delta review |
| `docs/security/consent-model.md` | Pending real-onboarding review |
| `docs/security/retention-and-deletion.md` | Pending approved schedule and deployed evidence |
| `docs/security/security-privacy-approval-plan.md` | Pending feature-delta evidence |
| Exact adapter/network/deployment evidence | Does not exist; required after any favorable source disposition and before activation |
| Exact real-data deployment/rights evidence | Does not exist; required before LR-D1-04 activation |

## Reviewer identity and accountability

| Role | Reviewer legal name | Organization/title | Independence or conflict disclosure | Authority evidence | Date |
|---|---|---|---|---|---|
| Legal/privacy counsel for LR-D1-01 | Pending | Pending | Pending | Pending | Pending |
| Legal/privacy counsel for LR-D1-02 | Pending | Pending | Pending | Pending | Pending |
| Legal/privacy counsel for LR-D1-03 | Pending | Pending | Pending | Pending | Pending |
| Legal/privacy counsel for LR-D1-04 | Pending | Pending | Pending | Pending | Pending |
| Independent security/privacy reviewer for LR-D1-04 | Pending | Pending | Pending | Pending | Pending |
| Product-risk owner | Pending | Pending | Not a substitute for reviewers above | Pending | Pending |

## External authority freeze

Reviewer must replace every `Pending` with the exact material actually relied on, including a PDF,
digest, immutable link, provider correspondence, agreement/order, or dated archived copy where a
web page can change.

| Row | Material observed by engineering on 2026-08-16 | Exact version/date/agreement reviewed | Governing authority and jurisdiction | Evidence location |
|---|---|---|---|---|
| LR-D1-01 | [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html), [API overview](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview), [partner program](https://www.greenhouse.com/integration-partner), [legal center](https://www.greenhouse.com/legal) | Pending | Pending | Pending |
| LR-D1-02 | [Lever Postings API master `f61aac5831a193bc66e1183c3ad102739dfd9f56`](https://github.com/lever/postings-api/tree/f61aac5831a193bc66e1183c3ad102739dfd9f56), [job-board/feed use case](https://hire.lever.co/developer/usecases), [developer FAQ](https://hire.lever.co/developer/support), [legal center](https://www.lever.co/legal) | Pending | Pending | Pending |
| LR-D1-03 | [Ashby public API](https://developers.ashbyhq.com/docs/public-job-posting-api), [dedicated partner feed](https://developers.ashbyhq.com/docs/dedicated-partner-job-feeds), [customer terms](https://www.ashbyhq.com/resources/terms), [terms index](https://www.ashbyhq.com/resources/terms-and-policies) | Pending | Pending | Pending |
| LR-D1-04 | Current repository privacy/security package and exact deployed candidate | Pending | Pending | Pending |

## Row dispositions

### LR-D1-01 — Greenhouse public Job Board API

| Decision field | Reviewer entry |
|---|---|
| Status | `Not started` |
| Exact approved access path | Pending; unauthenticated public GET, employer-authorized feed, partner path, or rejected |
| Application POST boundary | Prohibited and outside this review; confirm or revise only through later D3 review |
| Employer/provider authorization required | Pending |
| Permitted boards/tenants/jurisdictions | Pending |
| Permitted fields and transformations | Pending |
| Prohibited fields/uses | Pending |
| Storage/search/redistribution conclusion | Pending |
| Attribution, source link, marks, and disclaimer | Pending |
| User-Agent/contact and request headers | Pending |
| Poll cadence/concurrency/page/volume cap | Pending |
| `429`/`Retry-After`/failure behavior | Pending |
| Freshness/revalidation/withdrawal rule | Pending |
| Takedown/correction/tombstone/retention rule | Pending |
| Required adapter/network/security/privacy evidence | Pending |
| Revalidation date/triggers and owner | Pending |
| Counsel conclusion and rationale | Pending |
| Conditions/findings | Pending |

Counsel must explicitly answer whether Greenhouse's unauthenticated published-job GET mechanics
authorize this third-party catalog use. Public access alone is not the answer. Record whether the
integration partner program or employer-specific token sharing/authorization is required.

### LR-D1-02 — Lever Postings API or approved job-board feed

| Decision field | Reviewer entry |
|---|---|
| Status | `Not started` |
| Exact approved access path | Pending; public Postings API, employer-provided XML feed, partner path, or rejected |
| Application POST boundary | Prohibited and outside this review; its documented POST rate limit grants no read/aggregation authority |
| Employer/provider authorization required | Pending |
| Permitted sites/global-or-EU instances/jurisdictions | Pending |
| Permitted fields and transformations | Pending |
| Prohibited fields/uses | Pending |
| Storage/search/redistribution conclusion | Pending |
| Attribution, source link, marks, and disclaimer | Pending |
| User-Agent/contact and request headers | Pending |
| Poll cadence/concurrency/pagination/volume cap | Pending |
| `429`/`Retry-After`/failure behavior | Pending |
| Freshness/revalidation/withdrawal rule | Pending |
| Takedown/correction/tombstone/retention rule | Pending |
| Required adapter/network/security/privacy evidence | Pending |
| Revalidation date/triggers and owner | Pending |
| Counsel conclusion and rationale | Pending |
| Conditions/findings | Pending |

Counsel must explicitly determine the legal significance of Lever's statement that published jobs
may be scraped by third parties and its separate job-board feed/partner materials. Do not infer
permission, scope, attribution, retention, or redistribution rights from that statement.

### LR-D1-03 — Ashby public API or dedicated partner feed

| Decision field | Reviewer entry |
|---|---|
| Status | `Not started` |
| Exact approved access path | Pending; lightweight public board API, opt-in dedicated partner feed, or rejected |
| Application/authenticated API boundary | Prohibited and outside this review |
| Employer/provider opt-in required | Pending |
| Permitted boards/partner organizations/jurisdictions | Pending |
| `isListed=false` treatment | Proposed hard exclusion; reviewer confirmation pending |
| Compensation treatment | Proposed `includeCompensation=false` and no retention; reviewer confirmation pending |
| Permitted fields and transformations | Pending |
| Prohibited fields/uses | Pending |
| Storage/search/redistribution conclusion | Pending |
| Attribution, source link, marks, and disclaimer | Pending |
| User-Agent/contact and request headers | Pending |
| Poll cadence/concurrency/volume cap | Pending; partner feed is documented as hourly but no authority is inferred |
| `429`/`Retry-After`/failure behavior | Pending |
| Freshness/revalidation/withdrawal rule | Pending |
| Takedown/correction/tombstone/retention rule | Pending |
| Required adapter/network/security/privacy evidence | Pending |
| Revalidation date/triggers and owner | Pending |
| Counsel conclusion and rationale | Pending |
| Conditions/findings | Pending |

Counsel must decide whether the dedicated partner feed is mandatory for a multi-employer catalog.
If it is, the lightweight public-board endpoint remains disabled even though it is publicly
reachable.

### LR-D1-04 — Real candidate onboarding

#### Legal/privacy disposition

| Decision field | Reviewer entry |
|---|---|
| Status | `Not started` |
| Entity, audience, jurisdictions, minimum age | Pending |
| Controller/processor roles and contacts | Pending |
| Exact permitted data categories and purposes | Pending |
| Prohibited fields and secondary uses | Pending |
| Legal basis and required notices by purpose | Pending |
| Terms/privacy/resume/analytics notice versions and reacceptance | Pending |
| Consent/authorization evidence and withdrawal behavior | Pending |
| Restricted/legacy sponsorship migration prerequisite | Pending; no real onboarding while unresolved |
| Rights verification, access, correction, export, deletion, appeal | Pending; implementation absent |
| Approved retention and backup-aging schedule | Pending; implementation does not match a public approved schedule |
| AWS/Auth0/telemetry/support subprocessors, regions, transfers, DPA | Pending |
| Complaint, incident, breach, and regulator contacts/timing | Pending |
| Founder-only dogfood eligibility and expiry, if any | Pending; no general authorization |
| Legal/privacy conclusion and rationale | Pending |
| Conditions/findings | Pending |

#### Independent security/privacy disposition

| Decision field | Reviewer entry |
|---|---|
| Status | `Not started` |
| Exact deployed environment/release reviewed | None; pending |
| Dedicated identity/session/MFA/recovery/revocation evidence | Pending |
| Owner isolation and authorization evidence for every D1 data owner | Pending |
| Resume quarantine/scan/parser/effective-IAM/adversarial evidence | Pending |
| ADR-023 DNS/covert-channel treatment | Pending |
| Encryption/KMS/secrets/network/egress evidence | Pending |
| Telemetry redaction, access, retention, and alert evidence | Pending |
| Support/admin least privilege and audit evidence | Pending |
| Correction/export/deletion/subprocessor/backup-replay evidence | Pending; implementation absent |
| Incident/vulnerability roles, contacts, exercise, and evidence | Pending |
| Recovery, RTO/RPO, rollback, and drift evidence | Pending |
| Accessible notice/consent/proposed-fact review evidence | Pending |
| Security/privacy conclusion and rationale | Pending |
| Conditions/findings | Pending |

## Findings and condition ledger

Every condition receives a stable ID. A reviewer, not the implementer alone, accepts closure.

| ID | Row | Severity/blocking | Finding or condition | Owner | Required evidence | State | Reviewer closure/date |
|---|---|---|---|---|---|---|---|
| Pending | Pending | Pending | Pending | Pending | Pending | Open | Pending |

Allowed condition states: `Open`, `Ready for retest`, `Closed`, `Accepted until <date>`. A source or
real-data gate stays closed while any release-blocking condition is `Open` or `Ready for retest`.

## Activation control record

This table must remain false until a separate implementation/deployment record proves the exact
row is eligible. A favorable review disposition does not itself flip a switch.

| Control | LR-D1-01 | LR-D1-02 | LR-D1-03 | LR-D1-04 |
|---|---:|---:|---:|---:|
| Accountable disposition complete | false | false | false | false |
| All blocking conditions accepted closed | false | false | false | false |
| Exact contracts/configuration frozen | false | false | false | false |
| Required implementation merged | false | false | false | false |
| Independent local evidence accepted | false | false | false | false |
| Immutable artifacts published/scanned | false | false | false | false |
| Database/infrastructure applied dark | false | false | false | false |
| Deployed synthetic acceptance passed | false | false | false | false |
| Dynamic kill/pause and rollback exercised | false | false | false | false |
| Product owner acknowledges scoped residual risk | false | false | false | false |
| Separate activation record approved | false | false | false | false |

For LR-D1-04, `Required implementation merged` includes complete correction/export/deletion,
subprocessor reconciliation, backup-aging replay, dedicated real-user identity, and approved
retention/notice controls. Synthetic evidence cannot set the final activation cell true.

## Final row summary

| Row | Final result | Effective date | Scope | Release-blocking conditions open | Revalidation/expiry | Signed record |
|---|---|---|---|---|---|---|
| LR-D1-01 | `Removed` | 2026-08-23 | Superseded by ADR-025 source activation | Exact product/source record remains | Per activation | [ADR-025](../../adr/025-public-ats-feed-activation-governance.md) |
| LR-D1-02 | `Removed` | 2026-08-23 | Superseded by ADR-025 source activation | Exact product/source record remains | Per activation | [ADR-025](../../adr/025-public-ats-feed-activation-governance.md) |
| LR-D1-03 | `Removed` | 2026-08-23 | Superseded by ADR-025 source activation | Exact product/source record remains | Per activation | [ADR-025](../../adr/025-public-ats-feed-activation-governance.md) |
| LR-D1-04 legal/privacy | `Not started` | — | None | All | Pending | Pending |
| LR-D1-04 security/privacy | `Not started` | — | None | All | Pending | Pending |

## Sign-off

| Role | Decision acknowledged | Name/signature or attributable record | UTC date |
|---|---|---|---|
| LR-D1-01 legal/privacy counsel | Not required by ADR-025 | ADR-025 | 2026-08-23 |
| LR-D1-02 legal/privacy counsel | Not required by ADR-025 | ADR-025 | 2026-08-23 |
| LR-D1-03 legal/privacy counsel | Not required by ADR-025 | ADR-025 | 2026-08-23 |
| LR-D1-04 legal/privacy counsel | Pending | Pending | Pending |
| LR-D1-04 independent security/privacy reviewer | Pending | Pending | Pending |
| Product-risk owner | No residual risk accepted | Pending | Pending |

After all required signatures and condition closures, a separate reviewed governance change may
update the legal register and D1 task records. That change must preserve the exact scope, evidence,
expiry, and remaining blockers; it must not mark D1 complete or enable a source merely because this
worksheet was signed.
