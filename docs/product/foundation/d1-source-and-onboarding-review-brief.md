# D1 Source and Real-Candidate Onboarding Review Brief

- Status: Review ready; LR-D1-01 through LR-D1-04 remain `Not started`
- Prepared: 2026-08-16
- Engineering input baseline: `4374bf89d1b73534997d210e62750b898c634d85`
- Accountable reviewers: Legal/privacy counsel and independent security/privacy reviewer; individuals
  unassigned
- Disposition record: [D1 review disposition worksheet](d1-source-and-onboarding-review-disposition.md)

This brief asks accountable reviewers to decide the narrow D1 activation conditions for three job
sources and real-candidate onboarding. It is an engineering input, not legal advice, provider
permission, privacy/security approval, or authority to process real data.

## Review objective and stop boundary

Record a separate attributable disposition for:

| ID | Capability | Release consequence while open |
|---|---|---|
| LR-D1-01 | Greenhouse public Job Board API ingestion | No Greenhouse production ingestion |
| LR-D1-02 | Lever Postings API or an approved Lever job-board feed | No Lever production ingestion |
| LR-D1-03 | Ashby public Job Postings API or an approved dedicated partner feed | No Ashby production ingestion |
| LR-D1-04 | Real candidate onboarding | Synthetic accounts and generated-synthetic documents only |

All four rows are `Not started`. Preparing or merging these documents does not move a row to
`Not reviewed` or `Approved`. Only the completed, attributable worksheet may support a later
register and delivery-record update.

Until the applicable row is approved and every recorded condition is closed:

- do not add or enable a real-provider registry entry, adapter, credential, endpoint, schedule,
  queue mapping, or network allowlist;
- do not retrieve a representative provider fixture or real response for testing;
- do not put real candidate identity, preferences, facts, resumes, saves, reports, or related
  metadata into development, CI, shared staging, or production;
- do not treat a provider's public-read mechanics as permission to aggregate, retain, transform,
  index, redistribute, or display its customers' postings; and
- do not use any provider application-submission endpoint. Application preparation/submission is a
  later D3 review boundary.

## Current repository facts

The source-neutral worker currently has no real-provider adapter or network client. Its immutable
registry accepts only a `synthetic-*` source identifier with provider `other` and provenance
`authorized_fixture`. The durable source composition and every source/runtime trigger are default
off. See the [worker boundary](../../../backend/workers/ingestion/README.md),
[source contract](../../../backend/workers/ingestion/src/contract.ts), and
[dark-release runbook](../../../infrastructure/runbooks/providers/synthetic-ingestion-dark-release.md).

The Jobs owner can persist normalized public-job observations, provenance, freshness, candidate
reports, and explicit moderation decisions. A report never changes lifecycle automatically. An
explicit source-pause decision is fail closed and this slice has no source-resume operation. See
the [Jobs boundary](../../../backend/services/jobs/README.md) and
[canonical job schema](../../../packages/domain/schemas/v1/canonical-job.schema.json).

The retained catalog observation does not currently link each `jobs.job_sources` row to the
runtime `sourceId`, adapter-configuration digest, or exact approval record. That linkage must be
designed, contracted, migrated, and independently verified before any real source activation.

For onboarding, managed web identity and some candidate-owned profile/document foundations have
synthetic development evidence. Real resumes remain prohibited. The end-to-end export and account
deletion workflow, dedicated real-user identity tenants, public retention schedule, optional
analytics preference, accountable incident operation, and deployed real-data privacy/security
acceptance do not exist. These are activation blockers, not accepted risks. See the
[privacy assessment](../../security/privacy-impact-assessment.md),
[data map](../../security/data-flow-and-classification.md),
[consent model](../../security/consent-model.md), and
[retention specification](../../security/retention-and-deletion.md).

## Provider materials observed on 2026-08-16

The following facts summarize provider-published material only. Counsel must determine which terms
actually govern ApplyDash, obtain any required employer/provider permission, and freeze the exact
policy or agreement reviewed.

| Row | Public-read mechanics observed | Separate path that must not be conflated | Unanswered authority question |
|---|---|---|---|
| LR-D1-01 | Greenhouse documents unauthenticated GET access to published board/job data through `boards-api.greenhouse.io` and optional job content. | The Greenhouse application POST is Basic-Auth credentialed and out of D1 scope. Greenhouse also operates an integration partner program. | Does the public GET documentation permit a third-party candidate catalog to ingest, normalize, retain, index, and redisplay postings without a direct employer or Greenhouse agreement? |
| LR-D1-02 | Lever documents a public Postings API for published postings and says published postings are publicly viewable and may be scraped by third parties. | Lever separately describes an XML feed for job boards and a partner process. Application POST behavior and its rate limit are out of D1 scope. | Is the public Postings API sufficient authority for this service, or must each employer opt in or ApplyDash use the job-board feed/partner path? |
| LR-D1-03 | Ashby documents a lightweight API for an organization's currently published postings and an `isListed` signal. | Ashby separately offers partners an opt-in dedicated job feed updated hourly. Application form APIs and authenticated Jobs APIs are out of D1 scope. | Must ApplyDash use the dedicated partner feed, and is any use of the lightweight board API allowed without employer-specific authorization? |

Primary materials:

- Greenhouse: [Job Board API](https://developers.greenhouse.io/job-board.html),
  [API overview](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview),
  [integration partner program](https://www.greenhouse.com/integration-partner), and
  [legal center](https://www.greenhouse.com/legal).
- Lever: [Postings API documentation at reviewed master revision
  `f61aac5831a193bc66e1183c3ad102739dfd9f56`](https://github.com/lever/postings-api/tree/f61aac5831a193bc66e1183c3ad102739dfd9f56),
  [job-board/feed use case](https://hire.lever.co/developer/usecases),
  [developer FAQ](https://hire.lever.co/developer/support), and
  [legal center](https://www.lever.co/legal).
- Ashby: [public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api),
  [dedicated partner feeds](https://developers.ashbyhq.com/docs/dedicated-partner-job-feeds),
  [customer terms](https://www.ashbyhq.com/resources/terms), and
  [terms and policies index](https://www.ashbyhq.com/resources/terms-and-policies).

The public documentation did not provide a reviewed, stable GET rate limit for these three public
read paths. Silence is not an unlimited-use grant. Exact cadence, concurrency, backoff, and contact
requirements therefore remain provider/counsel conditions.

## Proposed minimum source-data boundary for review

This is the maximum requested D1 ingestion surface. Approval may narrow it. Any new field requires
a new review delta before activation.

| Canonical field | Purpose | Greenhouse candidate source | Lever candidate source | Ashby candidate source | Default if absent or ambiguous |
|---|---|---|---|---|---|
| `provider`, `provenance`, `adapterVersion` | Retained catalog provenance | Fixed provider; `permitted_api` only after approval; fixed adapter version | Fixed provider; `permitted_api` only after approval; fixed adapter version | Fixed provider; `permitted_api` only after approval; fixed adapter version | Reject unapproved provenance or adapter |
| `sourceId`, `adapterConfigSha256`, approval-record ID | Exact runtime, kill-switch, configuration, and authority provenance | Fixed reviewed configuration | Fixed reviewed configuration | Fixed reviewed configuration | Required before activation, but not currently retained with each catalog observation |
| `atsTenant` | Separate employer/board namespace | Exact board token | Exact site name plus global/EU instance | Exact board name or approved partner organization ID | Required configuration; never guessed |
| `externalJobId` | Exact deduplication | Published job-post `id` | Posting `id` | Dedicated-feed `id`; lightweight API has no documented ID field in the reviewed table | Omit; fall back to canonical URL identity |
| `employerRequisitionId` | Stronger exact identity | `requisition_id` when present | Not requested | Not requested | Omit |
| `companyName` | Candidate display | Retrieve-job `company_name`, cross-checked against reviewed board configuration | Reviewed employer/site configuration | Partner-feed `organizationName` or reviewed lightweight-board configuration | Reject if no attributable value exists or configured/source values conflict |
| `title` | Candidate display/search | `title` | `text` | `title` | Reject empty value |
| `locations` | Candidate display/search | Published primary `location.name`; any office mapping needs separate exact review | `categories.allLocations` or primary location | Lightweight primary/secondary location names; partner-feed `locations[].locationName` | Preserve unknown; never manufacture geography |
| `department` | Candidate display/search | One exact published department only; omit when zero or multiple values cannot map losslessly | `categories.department` | Lightweight `department`; partner-feed `departmentName`; never silently substitute team | Omit |
| `description` | Candidate display/search | Decoded and sanitized published `content` | Plain-text description fields only | `descriptionPlain` only | Reject empty value; never retain executable HTML |
| `sourceUrl` | Attribution, user verification, canonical identity | `absolute_url` | `hostedUrl` | Lightweight `jobUrl` only; the partner feed's application-form `externalLink` is excluded | HTTPS and approved host only; partner feed remains blocked until a non-application job-detail/attribution URL or contract change is approved |
| `workMode` | Exact filtering/matching evidence | Not requested unless a separately reviewed explicit metadata mapping exists | Exact `workplaceType` mapping | Lightweight exact `workplaceType` only; do not derive it from partner-feed `isRemote` | `unknown`/omitted; never infer from prose or remote eligibility |
| `employmentType` | Exact filtering/matching evidence | Not requested unless a separately reviewed explicit metadata mapping exists | Exact allowlisted commitment mapping | Exact documented `employmentType` mapping | `unknown`/omitted; unsupported values remain unknown |
| `validThrough` | Source-expiry ceiling | Optional retrieve-job `application_deadline`, only after closure/timezone/absence/list-detail semantics are approved | Not documented in reviewed public fields | Not documented in reviewed public fields | Omit; never derive from publish/update time |
| `observedAt` | Our fetch provenance | Trusted server receipt time | Trusted server receipt time | Trusted server receipt time | Required; never a provider-supplied timestamp |

Not requested: arbitrary/custom metadata, application questions, application URLs as a separate
action surface, compensation, salary descriptions, contact details, HTML snapshots, tracking
parameters, cookies, candidate or recruiter records, internal/unlisted/draft postings, application
forms, credentials, analytics identifiers, or provider account data.

Provider-specific inclusion rules proposed for review:

- Greenhouse: only published external board/job GET responses. Prospect posts with no underlying
  job identity, custom metadata, education/application endpoints, and every POST are excluded.
- Lever: only published public postings from the correct global or EU public endpoint. Internal,
  confidential, closed, draft, pending, rejected, application, opportunity, and candidate records
  are excluded. Plain-text description fields take precedence over styled HTML.
- Ashby lightweight API: only `isListed=true` postings. `isListed=false` direct-link records are
  not catalog eligible, and `includeCompensation=false`; compensation remains out of the canonical
  D1 contract. Ashby dedicated partner feed: accept only opted-in organizations' published feed
  rows; do not infer `isListed` or work mode from a missing field or from `isRemote`. Its
  `externalLink` is an application-form URL and is not an approved D1 source URL. If
  counsel/provider requires the partner feed, the lightweight endpoint stays disabled, and feed
  activation remains blocked until a non-application detail/attribution URL or an explicit
  contract change is reviewed.

## Questions for LR-D1-01, LR-D1-02, and LR-D1-03

The accountable reviewer must answer every question separately for each provider. A cross-provider
answer is valid only if it names all three rows and explains why the same conclusion applies.

### Authority and scope

1. Which exact terms, API documentation, employer authorization, partner agreement, or written
   provider communication governs this use, at what version/date, entity, and jurisdiction?
2. Is server-side retrieval for a candidate-facing multi-employer job catalog permitted, or is the
   documented public endpoint limited to an employer's own careers page?
3. Must ApplyDash join a partner/feed program or obtain employer-by-employer opt-in? If so, what
   record proves an employer remains opted in?
4. Which requested fields may be retrieved, normalized, hashed, deduplicated, searched, displayed,
   and retained? Which must be excluded or displayed without modification?
5. May plain-text descriptions be normalized for whitespace and safe display? Are truncation,
   deduplication, translation, summaries, matching features, or search indexing restricted?
6. Is display outside the provider-hosted page redistribution, and are cache, backup, internal
   moderation, or search-index copies separately restricted?
7. What provider/employer name, logo, link, attribution, disclaimer, or source label is required or
   prohibited? May the product use only text attribution and a deep link?
8. Do job text, embedded names/contact details, metadata, location, or compensation create privacy,
   publicity, IP, or jurisdiction-specific obligations even though the posting is public?

### Freshness, removal, and complaints

9. What is the maximum approved poll frequency, concurrency, page size, daily volume, and retry
   budget per board/site/feed? How must `429`, `Retry-After`, maintenance, and undocumented limits
   be handled?
10. Which source field or response proves a posting remains listed, and what constitutes an
    authoritative withdrawal? Absence, an incomplete page, timeout, or parse error must not be
    treated as withdrawal without an approved rule.
11. What is the maximum revalidation interval and stale grace for an active listing? The current
    source-neutral catalog's 30-day default is engineering behavior, not a provider-approved SLA.
12. How quickly must a withdrawn, unlisted, corrected, or reported posting disappear from search,
    public detail, caches, backups, and any downstream recipient?
13. What provider/employer/takedown contact and evidence channel is required? May a candidate report
    trigger temporary suppression, or must an accountable operator decide?
14. What minimal tombstone may remain after removal: opaque job/source ID, URL hash, content hash,
    timestamps, reason code, and audit proof? How long may each item remain?
15. What event requires immediate source pause, and what evidence and accountable approval are
    required before a paused source can ever be reactivated?

### Network identification and operational conduct

16. Which exact hosts, regions, API/feed variants, path patterns, redirect policy, and TLS
    requirements are approved? Are robots instructions relevant to the API path?
17. What User-Agent or other identification must be sent? Approve an exact value containing a
    versioned product identifier and monitored legal/operations contact; no contact is currently
    selected.
18. Must requests carry customer/employer attribution, partner credentials, feed tokens, source
    parameters, or a tracking-source value? Where may such values be retained, and are any
    Restricted credentials involved?
19. Must the adapter preserve ETag, Last-Modified, request ID, provider timestamp, or other proof?
    May these values enter audit records without retaining a response body?
20. Are there contractual security, vulnerability disclosure, incident notice, availability,
    audit, deletion, or subprocessor requirements for this integration?

## Engineering controls required after a favorable source disposition

Approval alone does not activate a source. Each provider implementation must separately prove:

- one source-specific adapter and immutable version/config digest; no generic HTML crawler;
- exact allowlisted HTTPS egress and redirect refusal, bounded DNS/TLS/connect/read/total timeouts,
  response-byte and item caps, content-type validation, cancellation, and SSRF defenses;
- an approved User-Agent/contact, single-source concurrency limit, exact schedule, deterministic
  bounded backoff, `Retry-After` handling, and a circuit breaker that does not bypass rate limits;
- an allowlist mapper for only the approved fields, plain-text sanitization, URL credential and
  tracking-parameter removal, schema validation, and no raw response or HTML snapshot retention;
- provider/provenance, runtime source ID, tenant/external ID, source URL, adapter version/config
  digest, server observation time, content hash, and approval-record identity sufficient to audit
  each retained observation, including the required contract and migration that do not yet exist;
- source-specific pagination/completeness checks; an incomplete or failed poll never infers
  withdrawal;
- positive revalidation, expiry, correction, employer/provider takedown, candidate-report
  moderation, tombstoning, cache invalidation, and downstream reconciliation tests;
- a default-off registry entry plus infrastructure, source, mapping, and runtime gates; an
  independently exercised dynamic pause/kill switch; and no source-resume path without a new
  attributable activation record;
- aggregate-only logs/events/queues with no descriptions, URLs, provider payloads, credentials, or
  candidate data; and
- generated-synthetic contract tests until the applicable representative-provider fixture
  ownership and authority are explicitly assigned. Under
  [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md), D2 owns job-page
  detection variants; that assignment does not authorize D1 API-response capture. Fixture
  permission remains separate from production-ingestion permission.

## LR-D1-04 real-candidate onboarding inputs

### Requested data and purposes

The review covers only candidate-requested onboarding and D1 discovery behavior through
candidate-requested job saves and reports. It does not cover application preparation/submission,
ATS form actions, inbox or
calendar access, outreach, billing-provider data, employer profile access, or post-submission
outcomes.

| Category | Maximum requested D1 data | Purpose | Current activation state |
|---|---|---|---|
| Identity/session | Managed OIDC subject/issuer, internal owner UUID, optional email, session/security metadata | Authenticate, authorize, secure, and support the account | Synthetic development only; dedicated real-user tenants and accountable review pending |
| Preferences | Target-role strings, optional location strings, selected work modes and employment types, optional minimum amount plus ISO currency | Candidate-directed search and conservative constraint evidence | Synthetic/local capability; public notice and real-data approval pending |
| Profile facts | Candidate-entered or resume-proposed identity, employment, education, project, skill, certification, and preference facts; value, version, verification, sensitivity, source, dates, and evidence spans | Truthful candidate profile and later candidate-controlled preparation | Real use prohibited; proposals require explicit review |
| Resume | File name, PDF/DOCX type, size, SHA-256, encrypted source bytes, deterministic normalized text/tree, processing state, bounded page/character counts, parser version and evidence offsets | Candidate-requested fact proposal extraction | CompleteDark processing triggers disabled; real resumes prohibited |
| Private job activity | Saved-job association and fixed-code job report; no free-text report | Candidate organization and catalog correction | Source/local evidence only; real-report retention/support approval pending |
| Operations/audit | Opaque IDs, fixed action/state/error codes, versions, timestamps, trace correlation, aggregate counts | Security, correctness, recovery, and accountable support | Candidate values remain forbidden from logs/events/analytics |

No restricted demographic, disability, veteran, health, criminal-history, signature, attestation,
work-authorization, or sponsorship answer is requested by this D1 onboarding surface. The OpenAPI
preference schema still contains a legacy `requiresSponsorship` boolean for compatibility, but the
current UI neither displays nor resubmits it and refuses a full-replacement save when it is loaded.
Real onboarding must not start until that legacy value has an approved migration to the future D3
restricted boundary or is otherwise removed under an approved plan.

Optional product analytics is off. Essential operational telemetry is not permission for product
analytics, advertising, employer profiling, or reuse of candidate content.

### Questions for legal/privacy counsel

1. Confirm the operating entity, nationwide-US launch scope, 18+ audience, controller/processor
   roles, contact details, applicable jurisdictions, and any registrations or prerequisites.
2. Approve or revise the exact purposes/data categories above and identify the legal basis,
   required disclosures, and prohibited secondary uses for each. Authentication or an API request
   is not purpose-specific consent.
3. Approve the exact onboarding, resume-upload/parsing, optional analytics, terms, and privacy
   notices, their version identifiers, just-in-time placement, reacceptance triggers, withdrawal
   effect, and evidence to retain.
4. Confirm whether any profile/resume field may be sensitive under an applicable law even when it
   is not in the product's `restricted` class. Specify collection, access, consent, deletion, and
   support conditions.
5. Confirm rights-request scope, verification, response periods, correction, portable export,
   deletion, appeal/escalation, lawful exceptions, backup aging, and any retained tombstone/legal
   hold. The end-to-end export/deletion workflow is currently unimplemented.
6. Approve one coherent retention schedule for active profile/preferences, source and normalized
   resumes, facts/evidence, saves, reports, audit, logs, analytics, exports, quarantine, and backups.
   Current seven-day synthetic RDS backups do not implement the provisional 35-day public policy.
7. Review AWS, Auth0, telemetry, and any support system as subprocessors/recipients: exact entity,
   service/data regions, DPA, subprocessors, transfers, access, retention, deletion, breach terms,
   and candidate disclosures.
8. Specify incident-notification decision roles/timing, complaint and rights contacts, and the
   public claims that may be made. No compliance claim may be inferred from this packet.
9. Determine whether a narrowly isolated founder-only dogfood remains eligible under ADR-011, and
   record an exact, expiring release if so. That cannot authorize other candidates or live ATS
   effects.

### Questions for the independent security/privacy reviewer

1. Verify dedicated real-user OIDC tenants, exact issuer/audience/scopes, renewal/revocation,
   passkey/MFA/recovery behavior, owner resolution, cross-account denial, CSRF/session/cookie
   controls, and authenticated browser acceptance.
2. Verify least-privilege access to every Profile, Documents, Jobs, Identity, audit, object, cache,
   queue, backup, and support surface; test enumeration, stale writes, idempotency conflicts,
   malicious values, and cross-owner access.
3. Review the complete resume path: bounded direct upload, KMS quarantine, malware scanning,
   event authenticity, exact-object temporary credentials, no-DB/no-routed-egress parser,
   deterministic output, adversarial PDF/DOCX corpus, dependency/image evidence, rollback, and the
   unresolved AWS-managed DNS covert-channel treatment in ADR-023.
4. Verify allowlisted telemetry and evidence redaction, log/audit access, retention enforcement,
   secret/token exclusion, incident evidence handling, and alerting without candidate values.
5. Execute correction, export, confirmed deletion, session/token revocation, queued-work
   quarantine, subprocessor reconciliation, backup aging, deletion-ledger replay after restore,
   and no ordinary recovery after confirmed deletion.
6. Review deployed encryption/TLS/KMS/secrets, network egress, WAF/rate/abuse controls, dependency
   and artifact provenance, vulnerability intake, incident roles/channels, recovery, and measured
   RTO/RPO for the exact real-data candidate.
7. Confirm notices and consent controls are accessible and fail closed, proposed resume facts are
   visibly distinct and never treated as confirmed, and no restricted or unsupported fact is
   silently collected or inferred.

## Evidence checklist before any favorable disposition can activate behavior

- [ ] Exact immutable repository commit and manifest reviewed
- [ ] Named reviewer, accountable role, independence/conflict statement, date, and signature or
  attributable external record
- [ ] Exact provider terms/API/feed/agreement versions and jurisdiction recorded per source
- [ ] Written permitted/prohibited behavior and field matrix per source
- [ ] Employer/provider opt-in or partner authorization evidence where required
- [ ] Attribution, user-agent, contact, cadence, concurrency, retry, and rate-limit conditions
- [ ] Freshness, incomplete-poll, withdrawal, correction, takedown, tombstone, and revalidation rules
- [ ] Exact adapter/network design, threat model delta, privacy data-flow delta, and fixture authority
- [ ] Source-specific tests, failure/abuse tests, dynamic kill-switch drill, rollback, and deployed
  dark acceptance with zero real data
- [ ] Real-onboarding notice/terms/consent versions and accessible UI review
- [ ] Dedicated identity, owner-isolation, parser, telemetry, support-access, incident, export,
  deletion, subprocessor, backup, restore, and retention evidence
- [ ] Every condition/finding has an owner, due/revalidation trigger, closure evidence, and reviewer
  acceptance
- [ ] Product owner acknowledges only eligible residual risks; counsel and independent security
  decisions are not replaced by product-owner acceptance

## Revalidation and automatic stop triggers

Pause the affected source or real-data onboarding immediately and reopen review for a provider
terms/API/feed change, employer opt-out, authorization expiry, new field/purpose/region, changed
attribution or rate requirement, complaint/takedown failure, material source-quality failure,
unapproved redirect/host, credential exposure, incident, deletion/export failure, identity or
owner-isolation failure, parser/control failure, new subprocessor, retention drift, or material
repository/deployment change outside the exact approved candidate.

The later D6 foundational counsel and independent launch-candidate reviews remain mandatory. A D1
disposition cannot approve public launch, D3 application actions, or any capability outside its
exact row.
