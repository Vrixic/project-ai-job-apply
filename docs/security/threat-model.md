# Phase 0 Threat Model

- Status: Engineering review ready; product, legal/privacy, and accountable security approval pending
- Method: STRIDE with explicit trust boundaries
- Last updated: 2026-08-11

## Protected assets

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

## Risk ownership and reassessment

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

## D1-007 reporting/moderation source delta

| Threat | Source control | Residual / release gate |
|---|---|---|
| Candidate reports leak identity or become unbounded free-form content | Owner UUID stays inside Jobs, the public contract accepts one fixed reason only, retained per-owner cap, aggregate review returns counts only | Retention/deletion and accountable support-access policy remain unapproved |
| Reports automatically suppress legitimate jobs or sources | Reports are immutable evidence only; lifecycle changes require a separate explicit versioned moderation decision behind `jobs:moderate`; the redacted console exposes aggregate counts only | The managed admin grant, alert threshold, deployed workflow, and representative accountable moderation-policy acceptance remain open |
| A compromised operator resumes a paused source or broadens ingestion | The Jobs-owned exact source/adapter/config pause is immutable; the durable runtime fails closed at schedule/resume, attempt, poll, and per-write boundaries, and provides no resume path | One already issued idempotent write may finish before the next gate check; any resume path still requires separate legal/source/runtime authority and audited deployment evidence |
