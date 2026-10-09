# Phase 0 Privacy Impact Assessment

Default-off observed-form selection delta (2026-10-09): candidate-invoked question capture reads
bounded top-frame structure only, excluding entered values and text inside controls. The candidate
manually transfers metadata by clipboard; explain that clipboard copies remain under their control.
Web lists saved metadata without values, confirms exact question meaning/context and requests
existing protected packet preparation. Raw questions are not sent to Applications or telemetry.
Memory is cleared on hidden/exit, unmount, packet change and original 60-second lease expiry.
No privacy/legal approval is inferred; [ADR-046](../adr/046-observed-form-saved-answer-selection.md)
retains default-off and accountable release gates.

- Status: Engineering review ready; accountable privacy/legal and security approval pending
- Last updated: 2026-08-25
- Assessment owner: Security/privacy engineering
- Accountable approvers: Future external legal/privacy counsel and independent security reviewer;
  individuals unassigned

This assessment covers the platform foundation and the intended data lifecycle. It does not approve
future ATS automation, public UGC, outreach, remote browsing, billing, or mobile-store processing.
Those capabilities require a delta assessment before activation.

## Processing boundary

The deployed Phase 0 slice accepts an authenticated synthetic user's job preferences, stores them
in the profile-owned PostgreSQL schema, emits an identifier-only outbox event, processes a durable
readiness workflow through the scale-to-zero Lambda runtime, and returns the owner-scoped result.
Development and synthetic staging have passed persistence, two-account denial, durable replay,
redacted telemetry, rollback, and restore exercises. Staging is normally dormant and temporarily
shares the development Auth0 issuer under
[ADR-014](../adr/014-shared-development-auth0-for-synthetic-staging.md); this is not identity
isolation evidence. The slice does not call ATS, AI, email, calendar, billing, extension, mobile,
or remote-browser providers.

[ADR-026](../adr/026-vercel-nextjs-presentation-hosting.md) selects Vercel for two isolated
Next.js projects: candidate web and moderation admin. The source configuration keeps AWS as the
authoritative API/data plane, dynamic previews identity-dark, and candidate/admin credentials
separate. No Vercel project, hosted managed-OIDC session, real candidate data flow, or provider
approval is claimed yet.

Shared development, CI, staging, and demos are restricted to synthetic data. Isolated founder-only
dogfooding with the founder's own data is accepted as product direction. A live founder ATS effect
is still inactive and requires an exact adapter/variant pilot release record satisfying
[ADR-011](../adr/011-staged-preproduction-data-and-founder-pilot.md). Production candidate
processing is not approved.

## Data inventory and purposes

| Data or activity | Class | Purpose | Necessity/minimization | Current state |
|---|---|---|---|---|
| OIDC subject, issuer, session metadata | Confidential PII; tokens are Restricted | Authenticate and secure the user's account | Resolve to internal ID; never expose provider subject publicly; short-lived tokens | Development web conformance and deployed owner isolation pass; dedicated real-user staging/production tenants and accountable approval remain pending |
| Job preferences | Confidential PII | Candidate-requested job discovery and application readiness | Store declared constraints only; exclude values from logs/events/analytics | Deployed with synthetic data in development and on-demand staging; real candidate processing not approved |
| Resume and confirmed profile facts | Confidential PII | Tailor truthful applications | Preserve provenance; collect only application-relevant facts | Planned D1/D3 |
| Voluntary demographic, disability, veteran, sponsorship, or legal answers | Restricted | Complete a specific employer form when explicitly directed | Store only user-supplied values in a dedicated vault; never infer; always show during final application review | Product direction accepted; planned D3 |
| Saved jobs | Confidential association with Public job data | Let a user organize intended applications | Private by default; no public contribution implication | Planned D1 |
| Public job contribution and contributor identity | Public content plus Confidential contributor link | Improve and correct the shared catalog | Explicit preview/consent; public identity hidden; minimal tombstone after removal | Planned D2 |
| Generated resumes, cover letters, and answers | Confidential PII | Prepare a candidate-approved application packet | Ground in confirmed facts; generated cover letters and improved/tailored resumes are temporary, never persisted, and expire within 30 minutes ([ADR-038](../adr/038-one-off-generated-application-materials.md)); answers follow their separate policy | Planned D3; expiry enforcement pending D3-064 |
| Application packet, approval, attempt, and confirmation | Confidential PII/Internal | Perform and evidence the candidate-authorized action | Immutable packet hash; no post-submission outcome collection | Planned D3/D4 |
| Browser session, OAuth credentials, sensitive answers | Restricted | Perform narrowly authorized external actions | Just-in-time access; no logs/events/analytics; immediate revocation/destruction | Planned D4/D5 |
| Outreach content and recipient | Confidential PII | Send one candidate-approved message | No inbox/calendar reading; per-send approval; suppression and limits | Planned D5 |
| Billing identifiers | Confidential PII | Maintain Free/Pro entitlement | Provider-neutral ID; do not store full payment credentials | Planned D6 |
| Operational telemetry | Internal | Reliability, security, debugging | Opaque IDs and redacted measurements only | Deployed redaction, trace, alarm-delivery, and aggregate workload evidence exists for the synthetic foundation |
| Web request and encrypted session metadata | Internal/Confidential; access tokens and session secrets are Restricted | Serve the candidate/admin presentation and server-side BFF | Two isolated Vercel projects; server-held tokens; no browser token exposure; minimum provider logs | Vercel selected and source-configured for synthetic acceptance only; provider and real-user activation review pending |
| Product analytics | Internal/de-identified where possible | Evaluate product behavior and quality | Phase 0 operational telemetry only; optional analytics later require an explicit preference and no raw candidate values | Planned after review |

## Data subjects and affected people

- Candidates who create accounts or direct application activity
- Contributors who explicitly submit public job information
- Outreach recipients, only if the later outreach feature is approved
- Support/operations personnel whose audited administrative actions are recorded
- Employer/contact individuals whose public professional details may appear in approved source data

The platform is not designed to profile employers, monitor employee behavior, or make hiring
decisions.

## Purpose and disclosure boundaries

- Candidate data is used to provide candidate-requested discovery, preparation, submission, and
  optional outreach—not for employer access or unrelated advertising.
- A model or external provider receives only the minimum data needed for an approved purpose and
  only after provider review.
- Candidate values are prohibited from general events, logs, fixtures, and analytics.
- Public job information does not make a candidate's save, interest, contribution identity, or
  application activity public.
- Product data collection ends at confirmed application submission; no downstream hiring outcome
  is collected.

## Privacy risks and required mitigations

| ID | Risk to people | Required mitigation | Residual state |
|---|---|---|---|
| P-01 | Profile or application data is exposed to another user | Owner predicate on every access, tenant tests, opaque public IDs, audited admin access | Deployed profile-operation two-account denial passes with synthetic identities; later APIs/admin paths require their own tests and approval |
| P-02 | Sensitive answers are inferred or reused without meaningful choice | Never infer; dedicated restricted vault; exact-context checks; always-visible final review; immutable packet approval | Implementation and external approval pending |
| P-03 | A private capture is accidentally treated as a public contribution | The extension exposes no private-capture control; contribution uses a distinct API, exact field preview, one explicit public-add command, and an immutable digest-bound authorization record | ADR-029 accepted; accountable D2 review pending |
| P-04 | More browsing/form data is collected than intended | Active-tab/minimum extension permissions; client sanitization; no cookies/history/form values | D2 delta review required |
| P-05 | AI provider retains or trains on candidate data | Provider contract/configuration review, minimum prompt context, no activation before approval | Provider not selected |
| P-06 | Candidate cannot correct, export, or delete data | Authenticated rights workflow, portable export, subprocessor ledger, deletion reconciliation | Correction and the complete technical export/deletion vertical are deployed default-dark; the generated-synthetic policy and Stage A preprovision are applied, while Stage B lifecycle acceptance and accountable privacy/security approval still block real candidate onboarding |
| P-07 | Backups or providers resurrect deleted data | Immediate active-system denial, backup aging, deletion ledger replay, provider reconciliation | Independent encrypted Object-Locked confirmation markers, provider reconciliation, and fail-closed restore replay are deployed default-dark; Stage A applies 35-day development retention, while deployed deletion/replay and accountable backup-aging acceptance remain open |
| P-08 | Logs or analytics become a shadow candidate database | Shared redaction, allowlisted telemetry schema, synthetic fixtures, release-blocking tests | Local redaction tests and deployed sanitized log/trace/workload inspections pass for the foundation; every new payload/provider needs delta tests |
| P-09 | A compromised workflow performs an unintended external action | Immutable packet approval, idempotency, revalidation, kill switch, no blind retry | Later implementation required |
| P-10 | Users misunderstand automation or privacy behavior | Just-in-time notices, plain-language state, review by exception, accurate public claims | UX/legal review pending |
| P-11 | Retention exceeds the candidate's expectation or business need | Purpose-bound retention, user controls, documented defaults, periodic deletion verification | Synthetic environment settings and provisional product defaults are documented separately; public durations and enforcement require approval |
| P-12 | A new feature silently changes processing | Mandatory privacy/security delta review and updated data-flow map before activation | Delivery gates documented |
| P-13 | A hosted web/BFF provider receives candidate sessions or request metadata beyond the intended boundary | Separate candidate/admin projects and credentials; server-held tokens; identity-dark previews; minimum logs; provider/DPA/retention/deletion/incident review before real users | Source controls are implemented; Vercel account configuration, deployed verification, and accountable real-user approval remain open |

## Individual controls and rights design

Subject to counsel confirming jurisdictional requirements, the product will provide:

- access to and correction of confirmed candidate facts;
- a portable authenticated export of owned data and relevant audit/consent records;
- revocation of optional consents without invalidating already completed lawful actions;
- disconnect and immediate credential revocation;
- deletion with visible state and subprocessor reconciliation;
- an appeal/correction path for public UGC moderation and takedown; and
- human support for failed rights requests and ambiguous identity verification.

The final response periods, identity-verification method, exceptions, and appeal requirements remain
legal-review items.

## Product decisions required

| Decision | Why it matters | State |
|---|---|---|
| Legal entity and precise launch jurisdictions | Determines applicable rights, notices, contracts, and regulator contacts | No entity formed; `Vrix LLC` provisional; nationwide US intended; formation and counsel enumeration pending |
| Minimum user age | Determines audience controls and whether minors' data is intentionally processed | Product decision: 18+ |
| Restricted-answer reuse | Persistent reuse reduces clicks but increases sensitivity and stale-answer risk | Product decision: restricted vault plus mandatory final review; implementation/approval pending |
| Optional analytics choice | Determines consent and preference-center design | Product decision: operational telemetry only in Phase 0; explicit preference for optional analytics later |
| Deleted-account recovery | Recovery convenience retains data after a deletion request | Product decision: no recovery after confirmed deletion; implementation/approval pending |
| One-off generated cover letters and improved resumes | Hidden packet copies, browser caches, or provider logs could outlive the promised window | Product decision 2026-10-04: no persisted content, maximum 30 minutes from generation completion; D3-064 enforcement/evidence and D3-012 provider/privacy review pending ([ADR-038](../adr/038-one-off-generated-application-materials.md)) |
| Accountable privacy and security approvers | Required for documented risk acceptance | Founder is product-risk owner; external counsel and independent security reviewer unassigned |
| Pre-approval founder dogfooding | Enables realistic testing but introduces real PII before foundational approval | Product decision: isolated founder-owned data permitted; live ATS effects require adapter-specific pilot approval; no pilot currently active |

## Review and change triggers

Reassess before any of the following:

- real candidate data enters development, staging, or production;
- a new data category, purpose, model, subprocessor, source, ATS, client permission, or country is
  introduced;
- public UGC, live automation, outreach, remote browsing, billing, or mobile distribution is
  enabled;
- a material incident, complaint, legal change, or provider-policy change occurs; or
- retention, consent, user-rights, or public privacy statements change.

## Evidence and known limitations

The current engineering evidence is indexed in the
[security/privacy approval plan](security-privacy-approval-plan.md) and the
[Phase 0 exit-readiness record](../product/delivery/evidence/d0-exit-review-readiness-2026-08-11.md).
It proves a synthetic foundation at specific revisions and times. It does not prove:

- complete account export/deletion, subprocessor reconciliation, or deletion-ledger replay;
- real-user staging/production identity isolation or real candidate data handling;
- provider contracts, data residency, notice/rights operation, or public retention promises;
- public UGC, AI, ATS automation, outreach, remote-browser, billing, mobile, or extension privacy;
  or
- the independent security posture of the eventual launch candidate.

Those limitations are release gates, not implicitly accepted residual risks. Accountable reviewers
record any approved conditions and expiry in the
[Phase 0 accountable review record](phase-0-accountable-review-record.md).

## Approval record

The default-off [manual extension handoff](../adr/045-manual-approved-application-handoff.md)
temporarily displays confidential/restricted approved candidate answers in trusted extension UI.
Preview memory lasts at most 60 seconds and respects earlier original deadlines; every copy
rechecks owner/approval/withdrawal. Restricted copying requires current question/context confirmation.
No documents, generated content, page capture, provider transmission or persistent answer queue is
added. Clipboard copies are candidate controlled and outside deletion guarantees. Synthetic tests
are engineering evidence; this addition does not alter the reviewer dispositions below or accept
installed-extension/live-provider/privacy residuals.

| Role | Reviewer | Result | Date | Scope/version | Conditions |
|---|---|---|---|---|---|
| Product owner | Founder/repository owner; legal name pending | Direction recorded | 2026-07-28 | Product decisions in this assessment | All product decisions recorded; external approval not granted |
| Privacy/legal reviewer | Pending | Not reviewed | — | — | Counsel required |
| Security reviewer | Pending | Not reviewed | — | — | Independent/accountable reviewer required |


D3-087 manual continuation delta: form-bound starts require a fresh matching imported structure
and explicit candidate confirmation. Only the scalar binding, original capture time and confirmation
cross the existing Applications command; SQL admission checks the 60-second lease after locks and
preserves saved-version/material/approval invalidation. This remains untrusted candidate attestation,
not provider proof. Identical accepted commands replay; changed proofs cannot silently replace the
original idempotent action. Compatible readers precede default-off client activation. No accountable
review or live acceptance is inferred from local tests; see proposed ADR-046.
