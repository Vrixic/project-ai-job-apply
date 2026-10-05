# Phase 0 Threat Model

- Status: Engineering review ready; product, legal/privacy, and accountable security approval pending
- Method: STRIDE with explicit trust boundaries
- Last updated: 2026-08-11

## D3 cover-letter delta (2026-10-02, engineering evidence only)

The isolated provider now requires one original fixed-purpose ledger claim before its dispatch
replacement, model call or result replacement. The private control operation consumes existing
authority only, resolving the stored owner and rechecking active candidate, immutable binding and
server-time admission under lock. The provider cannot issue/renew work or settle another phase.
Only the original acknowledged dispatch/completed-model/acknowledged-result path records settlement;
object presence and read-only replay cannot settle ambiguous effects. Delayed control responses are
awaited as original committed results; expiry, kill switches and local deadlines are rechecked
before effects. Offline and real SQL fixtures do not prove production authenticated control RPC,
provider IAM, failed-call remote settlement, retention or final-document enforcement. Those remain
blocking before activation; neither local timeout nor a rejected model request proves quiescence.

Private slot creation now enforces the work ledger before its first write. Only a fresh exact-bound
grant and positive original claim permit creation; replay cannot claim, recreate or settle work.
The S3 port checks single-attempt configuration before every PUT and requires positive one-attempt
HTTP 200 metadata plus a pinned owned version. Only all three original acknowledged writes allow
the initializer to settle. Lost acknowledgements, partial creation, local abort and late completion
leave the ledger unresolved, including when read-only replay can see every object. Real PostgreSQL
cases retain running work and refuse deletion until explicit synthetic fixture settlement. Offline
installed-SDK checks prove one HTTP write attempt, not deployed IAM/KMS or remote-provider drain.
Production provider/final-document composition, retention and quiescence remain unfinished.

The private Documents work ledger prevents renewable/replayed authority and accidental deletion of
unresolved work. Each phase can claim once within its immutable server-time admission window; SQL
enforces owner/request/consent binding, quarantine refusal and irreversible terminal states.
Cancellation tombstones also fence phases that had not started before quarantine. Neither expiry
nor RPC/SDK cancellation settles a running actor. Late finalization requires original provider
settlement and grants no new model permission. Ledger-only state is not production quiescence:
uncomposed actors, ambiguous remote effects, trusted settlement, IAM and restore replay remain
blocking gaps. The source primitive stays default-off with no public API or activation change.

Private owned-evidence composition now checks candidate activity and application ownership before
Profile values, reads the bound active posting through Jobs, removes restricted facts and snapshots
the graph/posting. End-of-read expiry/kill-switch checks and fixed failures prevent silent stale
context or diagnostic leakage. Twenty-one offline cases and three PostgreSQL cases prove local
owner separation/quarantine with supported owner-specific codecs and a distinct lease connection;
four Profile projection tests preserve evidence and detach mutable values. These checks neither
authorize dispatch nor prove live managed authentication, provider behavior, retention or cloud
quiescence. The factory remains uncomposed/default-off and accountable review remains open.

An empty object prefix is not quiescence: a pending SQL reservation may still have a late private
initializer. Cleanup now requires an injected trusted private proof before any inventoried letter
deletion, and before prefix cleanup of observed generation/final-draft keys. Missing, non-true,
failed or stalled proof refuses deletion; no local timeout is converted into success. Eight offline
gate cases and six connected PostgreSQL cases retain owner rows/quarantine before an explicitly
confirmed synthetic retry. No production proof port exists yet; bounded non-renewable writer/
provider authorization, retention, cloud IAM and accountable acceptance remain open.

Private Invoke now has a source-only default-off exact-numeric-version SDK adapter. Strict
reference-only envelopes, bounded UTF-8/canonical JSON replies, single-attempt SDK policy and
no log tails reduce transport leakage and replay risk; sixty offline cases include real SDK
serialization. Ambiguous outcomes retain original recovery identity. This does not authorize
dispatch after quarantine, prove remote quiescence or solve transient retention. No live provider,
cloud IAM or production composition is included; accountable privacy/security review remains open.

Private slot initialization now has a source-only default-off factory: the committed first
Documents reservation winner creates request/result/dispatch placeholders under the candidate
lease, with dispatch last. Replays only read pinned original slots and never recreate missing
ones. Twenty-one offline cases and one real PostgreSQL case cover concurrency, lost writes,
removed-slot replay and quarantine. This factory cannot invoke a model. A late private S3 PUT
after local abort remains a distinct deletion/quiescence risk even though replay is noncreating;
bounded private-writer authorization/drain/fencing, remote-provider quiescence and retention must
precede composition/activation. These tests do not prove live KMS/IAM or accountable acceptance.

The source-only, default-off generation service now has offline model/transport tests and real
local PostgreSQL evidence. Concrete controls cover versioned 15-minute disclosure, atomic
Applications acceptance, a write-ahead Documents dispatch reservation, active-candidate leases
against quarantine races, request-specific evidence selection/citations, complete job/evidence
bindings, parser-verified PDF/DOCX, immutable encrypted drafts and mandatory packet review.
Retries recover or poll the original draft and cannot generate again. Context changes refuse
file access and invalidate the artifact binding. Candidate text never enters events or logs.

This does not prove live-provider factuality/injection resistance, connected authorization/UI,
durable terminal recovery, export artifact completeness, restore/deployment permission fidelity
or accountable security/privacy approval. Those remain blocking before relevant activation.

Local durable tests now cover exact numeric activity targets, identifier-only contracts, bounded
retries and compensation; four real PostgreSQL tests connect generation and packet finalization
using synthetic evidence and offline provider/object transports. They do not prove production
dispatch or independently bound terminal recovery. ADR-016 additionally requires the live provider
outside the database VPC with no database credentials, using minimum owned object references.
That isolated transport/runtime is unfinished; private generation composition must not silently
introduce provider credentials or direct internet calls into the database activity.

Owned dispatch persistence now rejects foreign preparation/event bindings, pins the first numeric
workflow version and execution name, and prevents early lease replacement or receipt mutation.
Atomic terminal settlement preserves successful drafts and cannot promote an active operation
based on AWS success alone. Source-only starter/SDK tests cover canonical identifier-only retries,
exact ARN receipts and fixed errors. PostgreSQL tests cover lost start receipts and concurrent
claims. Scheduled recovery and independent EventBridge/status-reader handlers are still unfinished;
these local controls do not prove cloud delivery, IAM/source authenticity or production recovery.

Source-only reconciliation and terminal factories now use independently bound metadata-only AWS
reads. A terminal EventBridge event is only a nudge: exact stored function/version/name/ARN and
independent status/start/end must match before owned settlement. SDK reads reject returned
input/result/error data even when execution-data inclusion is false. Fair leased status claims,
bounded batches/time budget, fixed errors and exact-queue SQS handling have local synthetic/unit
and connected PostgreSQL evidence. Live IAM/source authenticity, deployed delivery and provider
runtime isolation remain unproven; no activation or accountable review follows from these tests.

The source-only isolated cover-letter transport now has strict owned/versioned/hash-bound,
KMS-encrypted request/dispatch/result slots and reference-only wire envelopes, verified with
offline tests. It is not composed with a live provider. An ambiguous/aborted private Invoke is a
specific unresolved privacy risk: the remote function could continue after the SQL identity lease
is released and recreate objects during deletion. Provider dispatch/recovery must bind a bounded
quiescence/deletion protocol and transient retention before activation; transport validation and
the current in-process model lease do not close that risk. Preserve minimum object references,
no database credentials outside the VPC, and no provider secrets inside the private activity.

The conditional-transition primitive now verifies precreated issued/pending slots, original
request identity and pinned ETags, and refuses missing/conflicting writes without creation.
[Proposed ADR-037](../adr/037-precreated-cover-letter-provider-slots.md) records the remaining
controls: provider creation must be forbidden and remote dispatch requires bounded privacy
quiescence. Source-only generation-slot purge now verifies current delete-marker fences and keeps
them until historical versions are gone, preventing old authorization resurfacing in offline
tests, including per-removal probes and failed-cleanup retries. Six synthetic PostgreSQL cases
include retention of quarantine and owner rows on incomplete fenced cleanup. Marker-creation
IAM is not configured. This is not a deployed purge, remote-runtime or complete deletion-safety
claim; creation restrictions, quiescence and transient retention still block activation.

The source-only provider handler now restricts object capabilities to reads and conditional
transitions, requires a positive dispatch-claim acknowledgement before one ModelGateway call,
and rechecks original consent and approved model identity. Ambiguous writes remain `in_progress`;
duplicate delivery cannot grant a second model call. Encrypted result recovery checks original
request/dispatch/provenance bindings and exposes references only, even after original consent
expires. Offline tests also refuse persistence after a local deadline and after slot deletion.
They do not prove remote/provider termination, legal retention, live permissions or private
grounding/rendering recovery. Do not activate the factory before the remaining quiescence,
creation prohibition, transient retention and runtime gates pass.

## Protected assets

Generated cover letters and improved/tailored resumes have a distinct temporary lifecycle under
[ADR-038](../adr/038-one-off-generated-application-materials.md): at most 30 minutes from generation
completion with no persisted content. Packet JSON, command receipts, durable checkpoints, browser
storage, renderer scratch files, and AI-provider diagnostic logs are potential hidden copies.
D3-064 must prove no-content persistence, active cleanup on idle/error/session termination, and
deadline enforcement immediately before ATS handoff. Expiry invalidates unsubmitted approval but
must preserve technical confirmation/ambiguity state so it cannot cause duplicate submission.
These are required controls; implementation/deployed evidence is pending.

- Candidate identity, sessions, resume/profile facts, preferences, application artifacts, answers,
  approvals, and submission evidence
- Restricted tokens, voluntary sensitive answers, secrets, and remote-browser sessions
- Public-job integrity, provenance, contribution identity, and moderation state
- Billing entitlements, audit history, encryption keys, workflows, and release artifacts

## Trust boundaries

1. User device ↔ public web/API edge
2. Gateway ↔ module-owned PostgreSQL schemas
3. Transactional database ↔ identifier-only outbox/SQS ↔ exact-version Lambda durable
   orchestrator ↔ private activity/terminal handlers. Stable execution identities, conditional
   claims, reconciliation, and terminal recovery prevent duplicate effective execution.
4. Workers ↔ ATS pages, AI providers, messaging providers, and object storage
5. Browser extension ↔ active tab ↔ Platform
6. GitHub Actions ↔ isolated AWS accounts
7. Operations/admin access ↔ confidential or restricted data

## Priority threats and required controls

| Threat | Impact | Required Phase 0 controls |
|---|---|---|
| Account takeover/token theft | Candidate identity and application compromise | Managed OIDC, PKCE, short-lived JWT validation, session revocation design, no tokens in logs |
| Cross-user object access | Confidential data disclosure | Internal user IDs, owner predicates on every read/write, authorization tests |
| Idempotency failure | Duplicate irreversible action | Scoped idempotency keys, unique constraints, stable workflow IDs |
| Database/event partial failure | Lost or orphaned work | One transaction for state and outbox, durable retries, reconciliation |
| Malicious job/form content | Prompt injection, phishing, unsafe redirects | Treat external text as untrusted, sanitize HTML, tool allowlists, URL/domain checks |
| Malicious resume/document | Parser compromise, decompression/resource exhaustion, candidate-data disclosure | Exact type/size/hash upload grants, isolated encrypted quarantine, managed malware scan, no-DB/no-egress parser Lambda, bounded PDF/DOCX parsing, deterministic output, no content telemetry, explicit proposed-fact review |
| Forged or contradictory scan result | Unscanned bytes parsed, wrong-environment event accepted, duplicate/contradictory proposals | Exact account/region/protection-plan/bucket/key/version contract, independent clean-tag and metadata check, canonical disposition receipt, security hold, value-free alarm |
| Extension overreach | Browsing-history collection | Active-tab/minimum permissions, explicit contribution preview and consent |
| Secret or PII leakage | Privacy/security incident | KMS/Secrets Manager, field-aware redaction, synthetic fixtures, scanning |
| Compromised CI/dependency | Supply-chain compromise | OIDC deploy roles, immutable images, full-lockfile audit, pinned Semgrep SAST, SBOM |
| Worker/provider exhaustion | Platform outage | Bulkheads, bounded retries, queues, rate limits, kill switches |
| Ambiguous submission | Duplicate or incorrect application | Never blind-retry; require manual confirmation path |
| Privileged support abuse | Confidential data access | Least privilege, redacted views, immutable audited access |
| Deletion gaps | Retained user data after request | Durable deletion workflow, subprocessor ledger, backup-expiry disclosure |

## Non-negotiable abuse boundaries

- Never bypass CAPTCHA, MFA, electronic signatures, attestations, or explicit submission approval.
- Never infer sensitive demographic, disability, veteran, sponsorship, or legal-consent answers.
- Never read inboxes/calendars or track hiring outcomes.
- Never expose user-contributed identity publicly by default.

## Open review gates

- Managed identity provider and session lifecycle
- Extension manifest and store disclosure
- Remote-browser isolation design
- Model-provider and outreach-provider contracts
- Independent open-book security assessment and penetration test of the exact launch candidate,
  including public-surface discovery, API authorization/abuse, cloud configuration, clients,
  application-agent business logic, remediation, and retest

## Phase 0 treatment status

The following table prevents a design requirement from being mistaken for deployed evidence or an
accepted risk. `Blocked by policy` means the capability cannot process real data or be activated
until the named gate passes; it does not mean an accountable reviewer accepted the residual risk.

| ID | Foundation risk or limitation | Current engineering treatment | Evidence state | Required next gate |
|---|---|---|---|---|
| TM-R01 | Cross-user profile/operation access | Issuer/subject maps to an internal owner; repository predicates and two-account negative tests fail closed | Local tests and deployed development/synthetic-staging denial evidence pass | Accountable foundation review; repeat for every later sensitive API family |
| TM-R02 | Development identity compromise also affects synthetic staging | ADR-014 restricts shared Auth0 trust to synthetic engineering acceptance; AWS data/control planes remain isolated | Limitation documented and environment tests pass; identity isolation is not claimed | Dedicated staging/production tenants and conformance before any real user or launch candidate |
| TM-R03 | Logs or workflow payloads disclose candidate values | Identifier-only events, allowlisted redaction, encrypted logs, sanitized evidence, and synthetic-only shared environments | Local redaction tests and deployed aggregate log/trace inspections pass for the foundation | Repeat payload/provider tests before each real-data capability |
| TM-R04 | Deleted data is restored or retained by an active system/provider | Pre-quarantine encrypted Object-Locked recovery marker, immediate denial, exact owner/provider deletion, backup aging, and fail-closed restore replay | The technical vertical is deployed default-dark and Stage A applies 35-day retention plus the empty managed provider-secret boundary; Stage B, generated-synthetic deletion/replay, backup-aging acceptance, and accountable review remain | Preserve default-off and prohibit real candidate onboarding until the deployed recovery and accountable gates pass |
| TM-R05 | No staffed incident or vulnerability response during real-data use | Runbooks define severity, containment, evidence, reconciliation, and intake; real-data/public use remains gated | Procedures are review ready; roles/channels and a staffed exercise are pending | Name roles/channels and exercise required scenarios before real data/public launch as applicable |
| TM-R06 | Deferred mobile build dependency can hang on malicious image formats | Exact expiring dependency exception forbids untrusted ICNS/JXL/HEIF input and all mobile public use | CI enforces the exact path/version/expiry; independent approval not granted | Remove or explicitly re-review before expiry or any mobile build/public test |
| TM-R07 | Future providers or agents gain excessive data/action authority | Provider activation register, least-data rules, immutable intent, effect safety, kill switches, and per-capability delta review | Architecture only; providers and external effects are inactive | Concrete provider/capability security, privacy, legal, and effect-safety approval |
| TM-R08 | Foundation review is mistaken for launch assurance | ADR-015 requires an independent open-book exact-candidate assessment, remediation, and retest | Policy accepted; launch-candidate evidence does not yet exist | Blocking D6 exact-candidate assessment and signed disposition |
| TM-R09 | A parser exploit exfiltrates resume data or survives retry | Separate no-DB parser, per-invocation exact-object credentials, no parser application logs/traces, no routed internet, deterministic output verification, strict parser limits, and stuck-state reconciliation | Implemented locally; AWS-managed DNS remains a covert-channel residual and no deployed adversarial/IAM proof exists | Keep triggers synthetic-only; independently review DNS treatment, adversarial corpus, effective IAM, rollback, and deletion/export before real resumes |
| TM-R10 | Sparse matching evidence is presented as a score, eligibility decision, or complete fit judgment | Owner-self reads return only ordered fixed-code evidence; exact known work/employment conflicts may exclude, unknowns remain unknown, restricted legacy sponsorship blocks review, and UI copy disclaims ranking/eligibility/outcomes | Source contracts, service, gateway, and web tests pass locally; no deployed or representative-quality evidence exists | Complete D1-R2 representative rubric/quality review and managed-OIDC browser acceptance before product reliance |

Accountable reviewers record findings, conditions, and treatment decisions in the
[Phase 0 review record](phase-0-accountable-review-record.md). This table must not be edited to
simulate reviewer acceptance.

## D3 restricted-answer export delta

| Threat | Source control | Residual / release gate |
|---|---|---|
| Export becomes a general secret-read API | Profile reader and final schema restrict values to the nine established restricted/never-infer fields; no ordinary Gateway plaintext read route; credentials, consent artifacts, and unknown keys refuse before decryption | Gateway write currently validates key syntax rather than taxonomy eligibility. Existing unexpected entries need an explicit disposition; they are not silently omitted. D3-012 review remains required |
| A foreign or stale reference decrypts the wrong answer | Owner, entry, field, context, latest active version, configured key ARN, and KMS encryption context are bound; correction/deletion during decryption is rechecked | Exports are point-in-time reads. Hosted owner isolation and correction/deletion races remain deployed acceptance work |
| Deletion reveals a retained historical answer | Deleted entries cannot contain values in the strict schema and are never sent to the decrypt reader; superseded versions are refused | Retained ciphertext and account-level erasure/backup aging still require candidate-rights and privacy acceptance |
| Provider failures leak answers into durable history | KMS adapter replaces provider messages with fixed codes; the activity returns fixed status/code only; plaintext is transient and only serialized into the encrypted rights artifact | Generated tests and mock KMS are not live log/history evidence or independent approval |
| Worker compromise gains broader vault access | Separate default-off gate, Decrypt-only exact-key/purpose-bound IAM, no Encrypt/GenerateDataKey grant, strict guarded activation and full live policy/environment readback | IAM cannot enforce database-derived owner intent by itself. Compromise of the authorized private worker remains restricted-data risk for accountable security review |

See [ADR-035](../adr/035-restricted-answer-values-in-candidate-export.md). No deployment or
real-data approval is implied by this engineering delta.

## Risk ownership and reassessment

- The product owner accepts or rejects residual candidate/product risk.
- The accountable security reviewer approves the threat/control treatment; repository authorship
  does not constitute independent approval.
- Legal/privacy counsel determines legal notification, consent, contract, and processing
  requirements.
- Each service/data owner proves ownership checks, minimization, deletion, and failure isolation for
  its bounded context.

Reassess for a new data class, provider, client permission, ATS/source, external side effect,
jurisdiction, trust boundary, authentication/session design, public feature, material incident, or
control failure. Capability-specific deltas are recorded in the
[security/privacy approval plan](security-privacy-approval-plan.md).

## D1-009A anonymous-read delta

| Threat | Source control | Residual / release gate |
|---|---|---|
| UUID enumeration or scraping exhausts the database | Exact route shape, rate/burst one, Lambda concurrency one, bounded LRU/negative cache, route 4xx/5xx and Lambda alarms | Distributed scraping and managed-edge response shape require live abuse testing before activation |
| Anonymous runtime compromise reaches candidate/private data, VPC interfaces, or Jobs | The no-VPC edge has no database identity/secret/RDS grant and can invoke only one qualified private projection with a strict UUID-only message. The projection alone holds the exact RDS-IAM user, verified TLS, code-path VPC/KMS denies, and security-definer read grant | A compromised edge can enumerate the same public UUID operation within concurrency/rate limits. RDS database-name and cluster-global residuals remain contained inside the non-public fixed-query projection. Deployment, abuse, and independent review still block route activation |
| Host/header injection poisons canonical metadata | Origin-only server configuration; request headers never select canonical host | Approved public hostname ownership remains a human gate |
| Employer text injects markup or structured-data claims | React text rendering, strict response schema/size, no dangerous HTML, and server-generated `JobPosting` JSON-LD only when the canonical record has every required truthful field; otherwise structured data is suppressed | Source-quality acceptance and the eventual public-host rendering remain release gates; employer text never supplies arbitrary markup or schema fields |
| Reversible alias is cached as permanent | Temporary redirect with current canonical metadata | Alias lifecycle acceptance must be rerun against deployed current data |

## Source-only private cover-letter read delta

Saved-document reads no longer require ModelGateway, Invoke, reservation or mutation capabilities.
The reader fixes owner identity, verifies exact packet/object bindings and holds the Identity-owned
active-candidate lease through evidence comparison and rendering. Quarantine waits for an admitted
bounded read and refuses later reads before evidence or object I/O. Single-connection PostgreSQL
tests reject nested-transaction deadlocks and verify this race for context, binding, preview and
file. This source-only change does not prove deployed IAM, privacy approval or remote-provider
quiescence; provider retention/drain/export and runtime composition remain separate release gates.

## Source-only cover-letter provider-control delta

Strict identifier/reference-only RPC envelopes and fixed provider-phase capabilities prevent
owner selection, work renewal, cross-phase settlement and content-bearing diagnostics at this
source boundary. Exact numeric Lambda versions, one SDK attempt and full original-reference ACK
validation reject alias drift, retries and mismatched receipts. Lost claim ACKs withhold model
dispatch; lost positive settlement ACKs allow only original-result recovery. Neither a local
timeout nor a target ARN proves caller authorization or remote-stopped effects. Reviewed sender
IAM, private runtime composition, trusted failed-call settlement, retention and deployed adversarial
acceptance remain release gates. The source remains default-off, not a production security approval.

## Source-only rejected-provider completion delta

An error named `OUTPUT_NOT_JSON`, `OUTPUT_TOO_LARGE` or `MODEL_DISABLED` may be thrown by an
already dispatched provider and must not certify stopped work. Internal completion receipts arise
only from the original fulfilled provider response, with prompt/model provenance captured before
dispatch. The trusted isolated actor verifies that provenance before invoking fixed-purpose
`settle_rejected`; no rejected result write occurs. Documents permanently fences future phases
before original provider settlement, so output rejection cannot grant finalization. Lost closure
ACKs and failure after fencing retain ambiguity/pending work; older capabilities fail closed.
This is default-off source control, not caller authentication or trusted production quiescence.
Errors, aborts, late responses and timeouts remain outside completion authority. Runtime/IAM,
retention and deployed independent security/privacy evidence remain release gates.

## D1-007 reporting/moderation source delta

| Threat | Source control | Residual / release gate |
|---|---|---|
| Candidate reports leak identity or become unbounded free-form content | Owner UUID stays inside Jobs, the public contract accepts one fixed reason only, retained per-owner cap, aggregate review returns counts only | Retention/deletion and accountable support-access policy remain unapproved |
| Reports automatically suppress legitimate jobs or sources | Reports are immutable evidence only; lifecycle changes require a separate explicit versioned moderation decision behind `jobs:moderate`; the redacted console exposes aggregate counts only | The managed admin grant, alert threshold, deployed workflow, and representative accountable moderation-policy acceptance remain open |
| A compromised operator resumes a paused source or broadens ingestion | The Jobs-owned exact source/adapter/config pause is immutable; the durable runtime fails closed at schedule/resume, attempt, poll, and per-write boundaries, and provides no resume path | One already issued idempotent write may finish before the next gate check; any resume path still requires separate legal/source/runtime authority and audited deployment evidence |

## D3-064 generated material persistence guard

| Threat | Source control | Residual / release gate |
|---|---|---|
| Generated letter text reaches packet JSON despite a separate artifact hash | AI proposal helper rejects cover-letter purpose and document-field targets; Applications requires canonical exact bound digests for both document fields, for every origin | Arbitrary caller-supplied content in unrelated answer fields is not semantically detected; ordinary candidate-authored answers have separate policies |
| A direct SQL writer bypasses application validation | Validated owner constraint admits only exact document artifact digests or unresolved nulls; migration rejects incompatible existing rows without rewriting | Explicit legacy-data disposition, reviewed migration/runtime rollout, and current-source restore identity are required |
| Hash-only packets are mistaken for completed one-off retention | ADR-038 and D3-064 remain In progress; saved S3/provider-slot generation paths cannot activate | Temporary-memory lifetime, idle cleanup, expiry/approval/submission checks, no-store transport, browser cleanup and approved provider retention remain unfinished |


D3-064 now adds a source-only Documents memory replacement for generated cover-letter completion
and reads. Exact generation metadata binds a non-renewable 1,800-second window; bounded buffers,
staged publication, idle cleanup, cancellation scopes and post-async checks refuse late content.
Original completion authority is mandatory but simulated in these tests; native immutable metadata
admission/RPC remains unfinished. No SQL/S3/provider/export or reconstruction capability exists
on the new content store. Production PDF verification uses separate scratch bytes so verification
does not detach the download; transient cover-letter renderer buffers/references are cleared.
This is managed memory/content-boundary evidence, not arbitrary string erasure, remote writer
quiescence, HTTP/browser cleanup, packet/ATS admission or approved provider-retention evidence.
Existing persisted generated-content paths remain ineligible for activation under ADR-038.
[Evidence](../product/delivery/evidence/d3-one-off-memory-runtime-2026-10-04.md).
