# Phase 0 Threat Model

- Status: Engineering review ready; product, legal/privacy, and accountable security approval pending
- Method: STRIDE with explicit trust boundaries
- Last updated: 2026-07-28

## Protected assets

- Candidate identity, sessions, resume/profile facts, preferences, application artifacts, answers,
  approvals, and submission evidence
- Restricted tokens, voluntary sensitive answers, secrets, and remote-browser sessions
- Public-job integrity, provenance, contribution identity, and moderation state
- Billing entitlements, audit history, encryption keys, workflows, and release artifacts

## Trust boundaries

1. User device ↔ public web/API edge
2. Gateway ↔ module-owned PostgreSQL schemas
3. Transactional database ↔ outbox dispatcher ↔ Temporal
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
