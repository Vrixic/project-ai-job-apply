# Auth0 Development Conformance Evidence

- Status: In progress
- Evidence date: 2026-07-29
- Environment: Isolated development; synthetic accounts only
- Scope: D0-010 managed-identity conformance

This is the sanitized evidence index for the Auth0 configuration selected in
[ADR-012](../adr/012-auth0-initial-managed-identity.md). It records outcomes, not credentials or
identity data. Tenant domains, client IDs, secrets, cookies, tokens, authorization codes, provider
subjects, full email addresses, IP addresses, and raw Auth0 logs must not be added.

## Verified evidence

| Boundary | State | Evidence |
|---|---|---|
| Public OIDC discovery | Passed | `verify-auth0-tenant.mjs` accepted the exact HTTPS issuer, authorization code flow, PKCE S256, RS256, HTTPS endpoints, and an RSA signing key. |
| Gateway token policy | Passed in development | Seven managed-verifier tests accept the exact RS256 issuer/audience and reject wrong issuer, audience, algorithm, expiry, and signature. The deployed gateway also rejected missing and deliberately invalid tokens with `401` and no provider/token disclosure. |
| Signing-key overlap | Passed locally | A warm verifier and a restarted verifier accepted the replacement RS256 key during an overlapping JWKS rotation; the removed key failed closed for a restarted verifier. |
| JWKS outage behavior | Passed locally | A warm verifier continued to validate a token with its cached key during a temporary JWKS outage; a cold verifier failed closed. |
| Web login and callback | Passed in development | The product owner completed Universal Login and the exact local callback with a synthetic development account. |
| Web API audience and scopes | Passed in deployed development | A server-held web session obtained a platform access token and completed the scoped preference write through the deployed AWS gateway without exposing the token to browser code. |
| Identity mapping and durable path | Passed in deployed development | The authenticated deployed request mapped the exact external identity to an internal UUID, persisted preferences and an operation, dispatched the transactional outbox event, and reached `succeeded` through the Temporal worker. Only sanitized request outcome counts and service state were inspected. |
| Candidate ownership | Positive deployed path and local negative test pass | The deployed operation read succeeded through its owner-scoped route. The profile persistence integration proves that a second internal user cannot read another user's operation; a deployed cross-user negative transaction remains open. |
| Unauthenticated behavior | Passed locally and deployed | A protected BFF write returned `401` without a server-side Auth0 session. The deployed gateway also returned `401` for missing and invalid bearer tokens without disclosing provider or token detail. |
| Web logout | Passed in development | The product owner logged out through the web route and confirmed the application returned to signed-out state with the protected save unavailable. |
| Preference continuity | Passed in development | The web BFF reads the existing owner-scoped preference contract after authentication. Gateway and PostgreSQL tests prove retrieval and cross-user isolation, and the product owner confirmed the saved preference set was restored after logout and reauthentication. |
| Web forced renewal | Passed in development | With rotating, expiring refresh-token settings configured for the Regular Web Application, the product owner used the development-only server path and received the sanitized renewal-success state. No token material crossed into browser-visible evidence. |
| Web authorization revocation | Passed in development | After revoking the synthetic user's authorized web application, the product owner forced renewal from the still-open local session and received the sanitized reauthentication-required state. The revoked grant could not renew. |
| User block and recovery | Passed in development | The product owner administratively blocked the synthetic user and confirmed login was denied, then deliberately unblocked the same user and confirmed login, owner-scoped preference restoration, and server-held renewal succeeded. |
| User deletion and old-session denial | Passed in development | The product owner permanently deleted the synthetic Auth0 user profile and confirmed its existing application session expired and could not regain protected API access. A later Google SSO login created a new Auth0 profile/session; continuity of the upstream subject was not inspected. |
| Reprovisioned identity isolation | Passed in development | Profile persistence resolves the exact issuer and subject, never email. Its PostgreSQL integration proves same-email/different-subject isolation, and an aggregate-only check after Google SSO reprovisioning confirmed the current internal user had no preference row while multiple distinct subjects existed for the same synthetic email. No email or subject value was inspected. |
| Expo public-client boundary | Passed locally; provider run deferred to D6 | The Native Application shell compiles and its tests prove fail-closed exact-audience configuration and sanitized errors. Auth0's native SDK owns system-browser PKCE and secure OS credential storage. This is preparation, not provider/device evidence. |
| Extension public-client boundary | Passed locally; provider run open | The MV3 shell compiles, tests the RFC 7636 S256 vector and exact callback/state checks, keeps tokens in trusted-context session storage, and builds without page permissions. An unconfigured build fails closed. |

## Open provider and device evidence

| Check | State | Required next evidence |
|---|---|---|
| Mobile PKCE, refresh, logout, cancellation | Deferred to D6 | Provision the dedicated Native Application and execute the Android/iOS provider and device matrix when mobile implementation begins. This no longer blocks the web-focused D0 exit. |
| Extension PKCE, refresh, logout, cancellation | Open | Create a dedicated Native Application, load the built MV3 shell, register its exact `chromiumapp.org` callback/logout URL, and execute the popup flow in Chrome and Edge. |
| Refresh-token replay detection | Open for extension; mobile deferred to D6 | With a disposable synthetic public-client session, rotate once, replay only the invalidated test token in a controlled harness, and prove the token family requires reauthentication without recording either token. Repeat for mobile in D6. |
| Current-device/all-device revocation | Open for extension; mobile deferred to D6 | Prove extension client revocation and accountable administrative revocation across the synthetic user's sessions. Repeat the device-specific matrix for mobile in D6. |
| Passkey, MFA, recovery, lost device | Open for web identity policy; mobile device cases deferred to D6 | Prove web enrollment, sign-in, reauthentication, recovery code use, factor loss, and recovery. Store no authenticator or recovery secret in evidence; repeat mobile recovery and lost-device cases in D6. |
| Provider/log-stream outage and recovery | Open | The deployed runtime and redacted encrypted application stream now exist; exercise a controlled provider/JWKS or log-delivery interruption and prove fail-closed/recovery behavior without recording tokens or identities. |
| Staging replay | Deferred until on-demand staging activation | Before staging processes users or becomes a release candidate, create its isolated tenant/clients and replay this matrix. Staging is not continuously provisioned under ADR-013. |

## Reproducible repository checks

```powershell
pnpm auth0:verify -- --issuer https://YOUR_TENANT.us.auth0.com/
pnpm --filter @ai-job-apply/auth test
pnpm --filter @ai-job-apply/mobile typecheck
pnpm --filter @ai-job-apply/mobile test
pnpm --filter @ai-job-apply/extension typecheck
pnpm --filter @ai-job-apply/extension test
pnpm --filter @ai-job-apply/extension build
```

The mobile and extension tests prove implementation boundaries, not successful Auth0 transactions.
The extension row remains open for its owning delivery, while real mobile transactions are
deliberately deferred to D6. Neither client may release until a person performs its
provider/browser/device flow and records only the sanitized result and timestamp.

The Auth0 deletion result proves provider-identity deletion and old-session denial only. It does
not claim that ApplyDash's future user-initiated durable deletion workflow has erased internal
records, backups, objects, analytics queues, or every subprocessor; that product-wide capability
and its accountable approval remain pending.
