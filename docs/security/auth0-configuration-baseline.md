# Auth0 Configuration and Migration Baseline

- Status: Development web conformance complete; synthetic staging exception active; launch isolation pending
- Last updated: 2026-07-30
- Owners: Platform engineering; security/privacy engineering
- Accountable approvers: Product owner, independent security reviewer, and legal/privacy counsel

This document turns [ADR-012](../adr/012-auth0-initial-managed-identity.md) into a testable
configuration boundary. It contains no tenant IDs, domains, client IDs, secrets, tokens, or real
user data.

## Tenant and client isolation

Create independent development, staging, and production Auth0 tenants. Do not share users, signing
keys, applications, secrets, logs, or Management API credentials across environments.

### Temporary pre-launch staging exception

[ADR-014](../adr/014-shared-development-auth0-for-synthetic-staging.md) permits controlled,
synthetic-only staging to trust the exact development issuer and `ai-job-apply-api` audience while
the current Auth0 Free subscription provides one tenant. This is not identity isolation:
development and staging share provider users, signing keys, logs, administration, availability,
and failure modes.

The exception permits no real candidates, invited testers, production PII, live ATS submissions,
public access, or launch-candidate claim. Do not copy development Auth0 client, Management API, or
session secrets into staging AWS; the staging gateway receives only the public issuer and
audience. AWS, data, KMS, state, logs, queues, artifacts, and durable execution remain environment
isolated.

Dedicated staging and production Auth0 tenants and environment-specific clients/APIs are mandatory
before staging handles real users or becomes a release candidate. Replay the applicable
conformance after cutover. Production must never trust the development issuer, and the launch
gate requires an Auth0 upgrade or approved provider migration if tenant isolation is still
unavailable.

Each tenant contains:

| Client/API | Auth0 shape | Required behavior |
|---|---|---|
| Next.js web | Regular Web Application | Server-held session; authorization code flow; API access through a BFF; no refresh token in browser storage |
| Moderation admin | Separate Regular Web Application | Server-held session; only `jobs:moderate`; no candidate scopes or token in browser storage; MFA and accountable operator assignment required before deployment |
| Expo mobile | Native Application | System browser; authorization code with PKCE; secure OS credential storage; rotating refresh token |
| Chrome/Edge extension | Public client, finalized by conformance test | `chrome.identity.launchWebAuthFlow`; authorization code with PKCE; no client secret; minimum extension permissions |
| Platform API | Auth0 API/resource server | Identifier `ai-job-apply-api`; RS256 access tokens; explicit platform scopes |
| Identity administration | Machine-to-machine application | Backend only; minimum Management API scopes; credential in the environment's managed secret store |

The provisional ApplyDash name may appear as development presentation text. Do not configure a
production custom domain, production sender, durable production passkeys, or public OAuth branding
until D6-012 approves the final name and owned domain.

## Authentication and token policy

- Use Universal Login; do not collect passwords in platform clients.
- Permit passkeys and a reviewed recovery method.
- Define the passkey/MFA policy before inviting real users; test enrollment, recovery, device loss,
  account deletion, and reauthentication.
- Use exact callback, logout, and web-origin allowlists; never use wildcard production origins.
- Request only `openid profile email` plus explicit API scopes. Request `offline_access` only where
  a reviewed client requires a durable session.
- Keep access tokens short lived; the initial target is ten minutes, subject to conformance and
  usability evidence.
- Enable refresh-token rotation, expiration, a minimal retry overlap, and automatic reuse
  detection.
- Require exact issuer and `ai-job-apply-api` audience validation and allow only RS256 for the
  initial configuration.
- Never log authorization codes, cookies, access/refresh/ID tokens, secrets, raw claims, or full
  email addresses.

The synthetic-only development tenant has passed passkey enrollment/sign-in, TOTP enrollment and
reauthentication, administrator-assisted MFA reset/re-enrollment, and recovery-code sign-in. Its
temporary `Always` test policy demonstrated redundant TOTP after passkey authentication, so the
tenant returned to `Never` while retaining passkey, TOTP, and recovery-code capabilities. This is
not a launch-policy approval. Before real users, define and test narrowly scoped reauthentication
or step-up behavior for sensitive actions and elevated-risk sessions, activate the final custom
authentication domain, re-enroll passkeys, and obtain accountable review.

## Data boundary

Auth0 may process the minimum authentication record: provider subject, email and verification
state, enrolled authentication methods, session/device metadata, and security events. Candidate
profile, preferences, resumes, job activity, application content, answers, consent, and billing
truth remain in platform-owned bounded contexts.

The platform stores the exact issuer and subject only in the restricted identity mapping. It emits
the internal user UUID to product services. Auth0 user metadata is not a product database.

## Secrets and administration

- Store web client and Management API credentials in AWS Secrets Manager, not Terraform values,
  source, client bundles, CI logs, or local shared files.
- Public mobile and extension clients have no secret.
- Protect Auth0 dashboard administrators with phishing-resistant MFA and least privilege.
- Use separate deploy credentials from runtime Management API credentials.
- Stream only approved, redacted authentication events to the environment's observability account.
- Alert on credential stuffing, refresh-token reuse, unusual administrator activity, log-stream
  failure, and signing-key/issuer changes.

## Conformance evidence by delivery

The provider selection does not complete D0-010. The web-focused foundation must prove:

- OIDC discovery and JWKS rotation behavior;
- valid token acceptance and wrong issuer, audience, algorithm, expiry, and signature rejection;
- web authorization-code login, server-held renewal, logout, revocation, and sanitized failure
  behavior;
- owner isolation when two authenticated candidates use the same APIs;
- web passkey enrollment/sign-in, recovery, MFA/reauthentication, and account lifecycle behavior;
- account deletion, Auth0 deletion reconciliation, and inability to re-use an old session;
- provider outage, JWKS-fetch failure/cache behavior, log-stream failure, and recovery;
- no secrets or restricted identity data in clients, logs, traces, events, fixtures, or plans; and
- Terraform/application rollback without enabling a test-token bypass.

The extension delivery D2 must prove its own authorization-code/PKCE login, refresh rotation and
replay handling, logout, cancellation, current-device/all-device revocation, and browser failure
modes before release. The mobile delivery D6 must prove the equivalent Native Application behavior,
secure OS credential storage, recovery, and lost-device handling on representative Android and iOS
devices before release.

Store sanitized evidence links in the owning delivery task record. Real identity data remains
prohibited in shared environments until the applicable approval gates are complete.

Per [ADR-013](../adr/013-lean-until-demand-cloud-runtime.md), staging is isolated but provisioned on
demand. The only pre-launch exception is the synthetic-only, exact-issuer arrangement in
[ADR-014](../adr/014-shared-development-auth0-for-synthetic-staging.md). Before staging processes
any real user or becomes a release candidate, create its independent Auth0 tenant and applicable
clients, cut over from the development issuer, and replay the applicable conformance matrix.

## Provider exit and migration

Auth0 can be replaced, but migration is an explicit security workflow:

1. Select and approve the replacement issuer while Auth0 remains operational.
2. Add the replacement verifier behind an issuer allowlist; never accept arbitrary issuers.
3. Ask an authenticated user to authenticate with the replacement provider and explicitly approve
   account linking.
4. Link the new `issuer + subject` to the existing internal UUID in an audited transaction. Never
   link accounts solely because email strings match.
5. Re-enroll passkeys or reset credentials when the provider/RP-domain transition requires it.
6. Revoke Auth0 sessions, reconcile deletion/export duties, and retain only policy-authorized audit
   evidence.
7. Remove the Auth0 issuer only after migration acceptance, rollback readiness, and accountable
   security/privacy approval.

Candidate-domain tables and public API contracts do not migrate because they reference the
internal user UUID rather than an Auth0 identifier.
