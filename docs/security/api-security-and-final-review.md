# API Security and Independent Final Review

- Status: Foundation controls have deployed evidence; exact launch-candidate assessment pending
- Owner: Platform/security engineering
- Accountable approver: Independent security reviewer; individual unassigned
- First required assessment: Exact public-launch candidate in D6
- Revalidation: At least annually while public and after a material trigger below

## Purpose and boundary

The platform intentionally exposes some public product surfaces. The security objective is not to
make every API unreachable by an outsider; it is to make every endpoint explicit, reveal only its
intended data and behavior, and deny every unauthorized identity, object, field, function, and
side effect. CORS, obscurity, unlinked routes, client-side checks, and hard-to-guess identifiers
are not authorization controls.

The final review supplements, rather than replaces, secure design, automated tests, code review,
cloud controls, monitoring, incident readiness, and capability-specific security/privacy gates.
No report or tool can prove that software has no vulnerabilities.

## Exposure classes

Every route, event receiver, object-download path, administrative action, and service interface
must appear in an owned inventory and have exactly one exposure class:

| Class | Intended caller | Required boundary |
|---|---|---|
| Public anonymous | Anyone, for an explicitly public feature | Minimum response data, schema and method allowlist, resource limits, abuse controls, no candidate state |
| Candidate | One authenticated candidate | Exact issuer/audience/signature/time/scope checks plus owner and field authorization on every operation |
| Service | One approved workload identity | No public route, least-privilege service identity, network and action policy, auditable calls |
| Administrator/support | Authorized personnel for a bounded purpose | Separate privileged scope, step-up authentication, least privilege, reason/expiry, immutable audit and alerting |
| Provider webhook | One configured provider | TLS, provider signature or equivalent authentication, freshness/replay validation, idempotency and schema allowlist |
| Temporary object access | One authorized subject and artifact | Short expiry, exact object/action binding, revocation where feasible, no list capability |

Browser, mobile, and extension applications are public clients. They never receive a trusted
client secret or an internal service credential. Internal and administrative interfaces must not
be made public merely because they require a token.

## Current foundation exposure inventory

This is the deployed development gateway inventory at the current foundation baseline. The
versioned [OpenAPI contract](../../packages/api-contracts/openapi/platform.v1.json) remains the
executable route source of truth. Later route additions require an updated inventory and their own
delivery evidence; this section is not approval of Phase 1 or later behavior.

| Method/path | Exposure class | Required boundary | Current evidence state |
|---|---|---|---|
| `GET /health/live` | Public anonymous | Fixed minimal health response; method/path allowlist; no candidate state | Deployed `200` probes and direct Lambda boundary tests pass |
| `GET /health/ready` | Public anonymous | Fixed minimal readiness response; method/path allowlist; no candidate state | Deployed `200` probes and direct Lambda boundary tests pass |
| `GET /v1/me` | Candidate | Valid Auth0 JWT with `profile:read`; resolved internal owner only | Auth and local gateway tests pass |
| `GET /v1/me/job-preferences` | Candidate | `profile:read`; owner-scoped query | Local and deployed persistence/isolation evidence passes |
| `PUT /v1/me/job-preferences` | Candidate | `profile:write`; strict schema/payload boundary; owner-scoped write | Local and deployed persistence/isolation evidence passes |
| `GET /v1/operations/{operationId}` | Candidate | `profile:read`; operation owner predicate | Deployed two-account denial passes |
| `GET /v1/jobs/{jobId}` | Candidate | `jobs:read`; active redacted canonical-job response | Implemented and deployed as later D1 work; not approved by D0-015 |
| `GET /v1/resumes` | Candidate | `documents:read`; candidate-owner predicate; metadata only | Implemented and locally tested as D1 work; not deployed or independently approved |
| `POST /v1/resumes/uploads` | Candidate | `documents:write`; strict metadata schema; idempotency; candidate owner; no file bytes | Implemented and locally tested as D1 work; not deployed or independently approved |
| Exact S3 resume-upload POST grant | Temporary object access | Five-minute expiry; one quarantine key/type/size/hash/KMS key; no read or list | Implemented and locally tested as D1 work; dark Terraform plan only |

There is no current public administrator, support, provider-webhook, temporary-object-download,
WebSocket, extension, mobile, ATS, AI, billing, outreach, or remote-browser API. The D1 upload
grant is write-only and is not currently deployed. The direct Lambda
boundary verifier rejects missing/invalid/wrong-issuer/wrong-audience/insufficient-scope identity,
unknown routes and methods, malformed bodies, unsupported media types, and oversized payloads.
The deployed profile slice additionally proves cross-user denial. These controls are engineering
evidence, not an independent assessment.

Current capacity is bounded by API Gateway/Lambda settings and low reserved concurrency. There is
no claim that account-, route-, or business-flow-aware public abuse controls are complete. Before
invited users or a broad public surface, the owning delivery must define measured throttles,
enumeration/automation controls, operational response, and false-positive handling without using
CAPTCHA or MFA bypasses.

## Required API and application controls

### Inventory and secure defaults

- Maintain a versioned inventory of domains, APIs, routes, methods, webhook receivers, WebSocket
  or streaming interfaces, object URLs, admin surfaces, and externally reachable cloud services.
- Reject unknown routes, methods, media types, fields, enum values, and unsupported API versions.
- Remove or protect development endpoints, debug output, schema explorers, test users, default
  credentials, sample secrets, source maps containing sensitive material, and stale deployments.
- Return minimal errors without stack traces, secrets, identifiers, authorization detail, or
  user-enumeration signals.

### Authentication, sessions, and authorization

- Validate OIDC signature, algorithm, issuer, audience, expiry, not-before, scopes, and authorized
  party where applicable; reject missing, malformed, revoked, wrong-environment, or replayed
  credentials fail closed.
- Enforce object-level, function-level, and property-level authorization server-side. Every
  candidate-owned query, cache key, workflow, artifact, event, and mutation includes the internal
  owner identity; opaque IDs are defense in depth only.
- Prevent mass assignment by mapping allowlisted request fields into explicit commands. Never
  deserialize client input directly into privileged or persistence models.
- Require fresh or step-up authentication for sensitive actions such as credential changes,
  restricted-answer use, exports, deletion, billing/support adjustments, and irreversible
  external effects when the owning policy requires it.
- Use secure cookie and CSRF defenses for browser sessions, PKCE and secure platform storage for
  public clients, short-lived access tokens, rotating refresh tokens, bounded sessions, explicit
  logout/revocation, and lost-device/account-recovery tests.
- Separate development, staging, and production issuers, audiences, credentials, data, and
  administrative authority before real-user staging or launch.

### Input, output, and integration safety

- Apply request body, header, URL, upload, pagination, nesting, decompression, and execution-time
  limits before expensive processing.
- Use parameterized database access, contextual output encoding, HTML sanitization, upload type
  and malware checks, safe archive handling, and strict redirect/URL/domain validation.
- Treat job descriptions, resumes, form HTML, model output, webhooks, provider responses, and UGC
  as untrusted. Protect against injection, prompt injection, SSRF, path traversal, unsafe
  deserialization, request smuggling, open redirects, and spreadsheet/formula injection where the
  relevant sink exists.
- Give outbound workers explicit egress policy and block private, link-local, metadata, loopback,
  and unapproved destinations. Never trust a third-party API response more than user input.
- Bind every external side effect to an authenticated actor, immutable approved packet or
  equivalent intent record, destination, idempotency key, audit event, and confirmation policy.

### Abuse and resource protection

- Apply rate, concurrency, payload, workflow, storage, and cost limits by IP/network signal,
  account, authenticated subject, route, provider, and sensitive business flow as appropriate.
- Protect registration, login, recovery, job contribution, document generation, application
  preparation/submission, outreach, billing, export, deletion, and support actions against bots,
  enumeration, replay, credential stuffing, scraping, spam, and resource exhaustion.
- Use bounded retries, timeouts, circuit breakers, queues, backpressure, quotas, kill switches,
  and dead-letter/reconciliation paths. Never blind-retry an ambiguous irreversible action.
- Put CloudFront/WAF, managed DDoS protections, or equivalent controls in front of the launch
  surface when the launch threat review or testing requires them. Capacity controls complement,
  rather than replace, application authorization and business-flow defenses.

### Data, secrets, infrastructure, and operations

- Encrypt traffic and stored confidential/restricted data; keep secrets in managed stores; rotate
  and revoke keys safely; prevent credentials and production PII from entering source, CI output,
  telemetry, analytics, fixtures, support tools, or security reports.
- Enforce least privilege for AWS, GitHub, Auth0, databases, queues, durable execution, object storage,
  support tooling, and deployments. Use short-lived administrative and deployment credentials.
- Scan dependencies, lockfiles, secrets, source, infrastructure, containers, licenses, and release
  artifacts; produce provenance/SBOM evidence and remediate supported-component vulnerabilities.
- Monitor authentication failures, authorization denials, rate-limit events, privileged access,
  data export/deletion, provider abuse, anomalous cost, and security-control failure without
  logging candidate content or credentials.
- Prove backup/PITR, restore, rollback, credential revocation, incident containment, workflow
  reconciliation, and deletion/export behavior against the launch configuration.

## Independent final assessment

The assessor must be independent of the people who principally designed and implemented the
tested controls. The assessment uses the exact release candidate, immutable image/build digests,
production-equivalent infrastructure and identity boundaries, representative test roles, and a
written rules-of-engagement document. Destructive or disruptive production testing requires a
separately approved window; the complete test normally runs in isolated launch-candidate staging,
with safe external-surface and configuration confirmation against production.

Minimum scope:

1. External attack-surface discovery covering domains, certificates, APIs, storage, cloud
   exposure, forgotten environments, admin/debug routes, and third-party callbacks.
2. Open-book architecture, threat-model, source, dependency, infrastructure-as-code, CI/CD,
   identity, secret, logging, incident, backup/restore, and data-flow review.
3. Black/gray-box web and API penetration testing with anonymous, candidate A, candidate B,
   privileged, revoked, expired, malformed, and wrong-environment credentials.
4. Explicit testing for broken object/function/property authorization, mass assignment, account
   enumeration/takeover, session and refresh replay, CSRF/CORS/cache mistakes, injection, SSRF,
   unsafe provider consumption, unrestricted resource use, sensitive business-flow abuse, and
   information disclosure.
5. Mobile and extension review covering secure storage, deep links, exported components,
   permissions, active-tab boundaries, update/package integrity, token handling, local data,
   network controls, and client tampering assumptions.
6. Application-agent business-logic tests covering packet approval/revalidation, restricted
   answers, destination binding, duplicate/ambiguous submission, CAPTCHA/MFA takeover, workflow
   replay, cancellation, provider outage, and kill switches.
7. Cloud and operational testing covering public exposure, IAM, security groups, encryption,
   object policies, secrets, logs, alerting, backups, recovery, denial-of-service controls, and
   incident-response exercises.
8. Remediation verification against the same release candidate or an exactly identified successor.

The test plan uses the current stable [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/),
[OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x03-introduction/),
[OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/), and
[OWASP MASVS](https://mas.owasp.org/MASVS/) as applicable, plus the
[NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) for the secure-development process. The
reviewer records the exact versions and selects additional tests from the platform threat model;
standards are a floor, not an exhaustive checklist.

## Evidence and launch acceptance

The retained sanitized evidence must identify the assessor, independence statement, scope,
rules of engagement, dates, release commit/build/image digests, environment, endpoint inventory,
roles tested, methods, exclusions, findings, severity rationale, reproduction reference,
remediation owner, retest result, residual risk, and approval expiry. Raw tokens, credentials,
candidate data, exploit secrets, and sensitive infrastructure identifiers stay in the restricted
assessment system, not this repository.

Public launch is blocked unless:

- every intended public surface is in scope and every exclusion has accountable written approval;
- no Critical or High finding remains open;
- every Medium finding is fixed or has explicit product/security-owner acceptance, compensating
  controls, an owner, and a short expiry;
- Low and informational findings are tracked with owners and review dates;
- fixed Critical, High, and applicable Medium findings pass independent retest;
- unauthorized cross-user, cross-role, wrong-environment, revoked-session, and anonymous access
  tests pass for every sensitive API family;
- incident, rollback, revocation, backup/restore, kill-switch, monitoring, vulnerability intake,
  and security-contact procedures are staffed and exercised; and
- the independent reviewer and product owner sign the exact launch-candidate disposition without
  claiming OWASP or another standards body certified the product.

Accepted findings never silently become permanent. Expiry, launch scope, compensating controls,
and revalidation triggers are part of the acceptance record.

## Reassessment triggers

Repeat the relevant independent assessment before release after a material authentication,
authorization, public API, admin/support, data-class, payment, extension/mobile permission,
application-agent, browser-runtime, cloud-boundary, provider, jurisdiction, or external-side-effect
change; after a serious incident or control failure; and at least annually while the product is
public. Continuous automated scanning and internal tests run between independent assessments.
