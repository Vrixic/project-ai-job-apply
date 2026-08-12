# Foundational Legal and Privacy Disposition Worksheet

- Status: Ready for accountable counsel; no legal conclusion or approval recorded
- Prepared: 2026-08-11
- Scope: D0-014 and LR-F01 through LR-F07
- Accountable reviewer: External legal/privacy counsel; individual unassigned

This worksheet is the auditable completion record for the foundational review requested in the
[legal/privacy brief](foundational-legal-privacy-brief.md). It is an engineering-prepared template,
not legal advice, a legal conclusion, or permission to process real candidate data or perform an
external action.

## Completion protocol

1. Freeze the review package at one repository commit and record that commit below.
2. Confirm or correct the product facts and launch assumptions before reaching a conclusion.
3. Review every artifact in the manifest and complete one disposition for every LR-F row.
4. Record each condition or finding with an owner, affected gate, evidence required for closure,
   and revalidation trigger or date.
5. Link a signed or otherwise attributable counsel record. Store only a sanitized summary in the
   repository; do not commit privileged advice, personal contact details, credentials, or real
   candidate data.
6. Have the product owner acknowledge the conclusions and separately accept only those residual
   risks counsel identifies as eligible for acceptance. Product-owner acceptance cannot override a
   legal prohibition or close a counsel-owned condition.
7. Synchronize the dispositions into the [legal review register](legal-review-register.md). D0-014
   remains blocked until every foundational row meets the closure rule below.

## Disposition vocabulary and closure rule

Use exactly one disposition for each LR-F row:

| Disposition | Meaning | Gate effect |
|---|---|---|
| `Approved` | Counsel permits the stated foundational assumption for the recorded scope with no open condition. | The foundational row may close; feature-specific gates still apply. |
| `Approved with conditions` | Counsel permits only the explicitly bounded behavior while recorded conditions remain in force. | The row may close only if every release-blocking condition is implemented and evidenced, or the disposition explicitly keeps the affected capability disabled for a later delivery. |
| `Rejected` | Counsel does not permit the reviewed assumption or behavior. | The row and affected capability remain blocked until product direction changes and counsel re-reviews it. |
| `Not reviewed` | No accountable conclusion exists. | The current strict pre-approval gate remains unchanged. |

`Review ready`, `Direction recorded`, `Prepared`, repository authorship, and product-owner risk
acceptance are not legal/privacy approval states. Foundational approval never inherits to a named
job source, UGC flow, ATS variant, browser permission, AI provider, outreach provider, mobile
store, new jurisdiction, or public launch; those remain feature-specific release gates.

## Reviewer and scope record

| Field | Counsel-provided value |
|---|---|
| Reviewer name | Pending |
| Accountable role and organization | Pending |
| Relationship to the product/entity and any scope limitation | Pending |
| Jurisdictions and legal topics reviewed | Pending |
| Intended entity/sponsor reviewed | No entity formed; `Vrix LLC` is provisional—counsel to confirm implications |
| Intended launch coverage reviewed | Nationwide United States—counsel to enumerate included/excluded jurisdictions |
| Repository commit reviewed | Pending |
| Review start/date completed | Pending |
| Signed or attributable external record | Pending; sanitized link or record identifier only |

## Product-fact confirmation

Counsel should mark each fact `Confirmed for review`, `Corrected`, or `Insufficient information`
and describe any correction without rewriting the underlying product decision silently.

| Fact | Recorded direction | Counsel confirmation/correction |
|---|---|---|
| Product role and terminal state | Candidate-directed preparation and submission; product ends at confirmed submission | Pending |
| Excluded processing | No coaching, inbox/calendar reading, employer-side surveillance, or post-submission hiring-outcome collection | Pending |
| Audience and age | US-English early-/mid-career software, data, and product professionals; 18+ | Pending |
| Launch geography | Nationwide United States, subject to counsel enumerating obligations and exclusions | Pending |
| Entity | No entity formed; `Vrix LLC` is a provisional future name | Pending |
| Truthfulness and sensitive answers | Never invent or infer; restricted answers are candidate-supplied and always included in final packet review | Pending |
| External actions | Separate, explicit authorization; immutable packet; no CAPTCHA/MFA bypass; direct action for signatures/attestations/ambiguity | Pending |
| Shared preproduction data | Synthetic candidate and ATS data only | Pending |
| Founder exception | Isolated founder-owned data only; live effects require an exact, written, expiring pilot gate | Pending |
| Data lifecycle | Purpose-limited collection; user correction/export/deletion; inaccessible backups age out within 35 days | Pending |
| Analytics | Operational telemetry only in Phase 0; optional analytics requires later explicit preference and review | Pending |

Any material correction must link to an updated product decision or finding before approval. A
correction recorded only in this worksheet does not silently amend an ADR or product requirement.

## Versioned review-package manifest

The repository commit above fixes the reviewed version of each relative path. Counsel should mark
every required artifact `Reviewed`, `Reviewed with finding`, or `Not reviewed`.

| Artifact | Purpose | Counsel state/finding IDs |
|---|---|---|
| [Product and system architecture](../../PRODUCT_AND_SYSTEM_ARCHITECTURE.md) | Product boundary, system behavior, and roadmap | Pending |
| [Launch decision](launch-decision.md) | Audience, geography, age, exclusions, entity, and naming boundary | Pending |
| [Foundational legal/privacy brief](foundational-legal-privacy-brief.md) | Review questions, fixed facts, and strict gates | Pending |
| [Legal review register](legal-review-register.md) | Foundational and feature-specific release consequences | Pending |
| [Staged preproduction/founder-pilot ADR](../../adr/011-staged-preproduction-data-and-founder-pilot.md) | Synthetic-only and narrow founder-pilot boundary | Pending |
| [UGC lifecycle ADR](../../adr/005-ugc-lifecycle.md) | Separate contribution, provenance, takedown, and tombstone direction | Pending |
| [Restricted-answer ADR](../../adr/010-restricted-answer-vault-and-mandatory-review.md) | Sensitive-answer storage and mandatory review boundary | Pending |
| [Privacy impact assessment](../../security/privacy-impact-assessment.md) | Processing inventory, privacy risks, rights, and triggers | Pending |
| [Data flow and classification](../../security/data-flow-and-classification.md) | Data categories, owners, recipients, and forbidden destinations | Pending |
| [Consent model](../../security/consent-model.md) | Separate authorization, revocation, and immutable evidence | Pending |
| [Retention and deletion](../../security/retention-and-deletion.md) | Provisional durations, export, deletion, and backup aging | Pending |
| [Subprocessor register](../../security/subprocessors.md) | Provider activation and contracting requirements | Pending |
| [Threat model](../../security/threat-model.md) | Abuse cases and legal/privacy dependencies | Pending |
| [Security/privacy approval plan](../../security/security-privacy-approval-plan.md) | Cross-review dependencies and evidence matrix | Pending |

If counsel relies on external terms, statutes, regulations, guidance, or provider policies, record
their jurisdiction, title, publisher, effective/version date, retrieval date, and durable reference
in the applicable row or signed record. A changing source/provider policy must have a named
revalidation owner and trigger.

## LR-F01–LR-F07 disposition record

| ID | Required accountable conclusion | Evidence focus | Disposition | Finding/condition IDs | Counsel rationale or signed-record section |
|---|---|---|---|---|---|
| LR-F01 | Entity/operating assumptions, covered US jurisdictions, 18+ boundary, applicable obligations, and any excluded jurisdiction or formation prerequisite | Launch decision; privacy assessment | Not reviewed | — | Pending |
| LR-F02 | Required notices, sensitive-data treatment, rights workflow, subprocessors, retention/deletion, breach duties, analytics choices, and cross-border/data-residency constraints | Privacy assessment; data map; retention; subprocessors | Not reviewed | — | Pending |
| LR-F03 | Candidate-directed role, authority, terms/disclosures, and any employment-agency, automated-decision, consumer-reporting, power-of-attorney, or consumer-protection implication | Architecture; brief; consent model | Not reviewed | — | Pending |
| LR-F04 | Separate preparation/submission/outreach authorization, electronic signatures/attestations, immutable packet evidence, revocation, and direct-user-action boundaries | Consent model; restricted-answer ADR; founder-pilot ADR | Not reviewed | — | Pending |
| LR-F05 | Rights-evaluation method, contributor license/representations, provenance, notice/takedown/appeal, repeat abuse, retention, and tombstone boundaries | UGC ADR; data map; retention | Not reviewed | — | Pending |
| LR-F06 | Required AI disclosures, truthful grounding, sensitive-answer prohibitions, accessibility, nondiscrimination, ranking/recommendation constraints, and human-review requirements | Architecture; privacy assessment; restricted-answer ADR | Not reviewed | — | Pending |
| LR-F07 | Required public terms, privacy/just-in-time notices, cookie/analytics choices, claim substantiation, version acceptance, change notice, and revalidation | Brief; consent model; legal register | Not reviewed | — | Pending |

## Finding and condition register

Assign stable IDs such as `LP-C01`. Do not use `Closed` until the named reviewer inspects the linked
evidence. If no finding exists, write `None` in the corresponding LR-F row rather than adding a
placeholder finding.

Copy one row per finding:

```markdown
| LP-C01 | LR-F__ | Release-blocking / Conditional / Advisory | Required change or restriction | Affected delivery/capability | Owner | Closure evidence | Open | Revalidation trigger/date |
```

| ID | LR-F row | Severity/effect | Required change or restriction | Affected gate | Owner | Closure evidence | State | Revalidation |
|---|---|---|---|---|---|---|---|---|

## Cross-review handoff

Legal/privacy approval and security/privacy approval are separate accountable acts. Before closing
D0-014, counsel and the product owner must identify every conclusion that changes the threat model,
data classification, consent, retention/deletion, subprocessor, incident, or security-control
design. Those items remain open in D0-015 until the accountable security/privacy reviewer accepts
the implementation and evidence. Likewise, a security control cannot substitute for a prohibited
or unreviewed legal basis.

| Handoff item | Destination control/finding | Owner | State |
|---|---|---|---|
| None recorded; populate during review | Pending | Pending | Not reviewed |

## Final foundational disposition

| Field | Counsel-provided value |
|---|---|
| Overall result (`Approved`, `Approved with conditions`, `Rejected`, or `Not reviewed`) | Not reviewed |
| LR-F rows closed | None |
| Open release-blocking conditions | None recorded; review not started |
| Explicitly permitted foundational assumptions | Pending |
| Explicitly prohibited behavior | Pending |
| Capabilities intentionally deferred to feature-specific review | D1–D7 rows in the legal review register; counsel confirmation pending |
| Revalidation triggers/date and owner | Pending |
| Reviewer attestation/reference | Pending |

## Product-owner acknowledgement

| Field | Value |
|---|---|
| Product facts confirmed/corrections incorporated | Pending |
| Counsel conditions assigned to accountable owners | Pending |
| Eligible residual risks accepted, with IDs and expiry | None |
| Strict gates preserved for unreviewed/deferred capabilities | Yes; must be reconfirmed at disposition |
| Product owner/date/reference | Pending |

## D0-014 closure checklist

- [ ] One exact repository commit and the complete artifact manifest were reviewed.
- [ ] Reviewer identity, accountable role, scope, jurisdictions, and attributable record are filled.
- [ ] Every product fact is confirmed, corrected through its source of truth, or explicitly treated
      as a blocking information gap.
- [ ] LR-F01 through LR-F07 each have an allowed disposition and rationale/reference.
- [ ] Every condition has an owner, affected release gate, closure evidence, and revalidation rule.
- [ ] Release-blocking conditions are closed by counsel or leave the affected capability disabled
      under an explicit later gate.
- [ ] Legal-to-security/privacy handoffs are recorded and remain open until separately approved.
- [ ] The product owner acknowledges the scoped conclusion without overriding counsel conditions.
- [ ] The legal review register matches the signed disposition.
- [ ] Synthetic-only shared environments, no production ingestion/public UGC, and no unapproved
      external action or public claim remain enforced for every unreviewed capability.

Only after this checklist is evidenced may delivery governance consider D0-014 complete. This
worksheet does not mark the delivery task or Phase 0 complete; those state changes belong to the
delivery records after accountable review.
