# Auth0 Development Conformance Evidence

- Status: Web-focused D0 scope complete; D2 extension source assurance and initial Edge login pass;
  remaining extension, mobile, staging, and launch gates remain
- Evidence date: 2026-07-30
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
| Identity mapping and durable path | Passed in deployed development | The authenticated deployed request mapped the exact external identity to an internal UUID, persisted preferences and an operation, dispatched the transactional outbox event, and reached `succeeded` through the Lambda durable workflow. Only sanitized request outcome counts and service state were inspected. |
| Candidate ownership | Passed in deployed development | The owner read succeeded through the deployed owner-scoped route. In a separate two-account transaction, synthetic account B received `404` for account A's completed operation; the browser received only a sanitized pass state. Aggregate AWS corroboration retained no identity or resource identifier. See the [cross-user isolation evidence](../product/delivery/evidence/d0-development-cross-user-isolation-2026-07-29.md). |
| Unauthenticated behavior | Passed locally and deployed | A protected BFF write returned `401` without a server-side Auth0 session. The deployed gateway also returned `401` for missing and invalid bearer tokens without disclosing provider or token detail. |
| Web logout | Passed in development | The product owner logged out through the web route and confirmed the application returned to signed-out state with the protected save unavailable. |
| Preference continuity | Passed in development | The web BFF reads the existing owner-scoped preference contract after authentication. Gateway and PostgreSQL tests prove retrieval and cross-user isolation, and the product owner confirmed the saved preference set was restored after logout and reauthentication. |
| Web forced renewal | Passed in development | With rotating, expiring refresh-token settings configured for the Regular Web Application, the product owner used the development-only server path and received the sanitized renewal-success state. No token material crossed into browser-visible evidence. |
| Web authorization revocation | Passed in development | After revoking the synthetic user's authorized web application, the product owner forced renewal from the still-open local session and received the sanitized reauthentication-required state. The revoked grant could not renew. |
| User block and recovery | Passed in development | The product owner administratively blocked the synthetic user and confirmed login was denied, then deliberately unblocked the same user and confirmed login, owner-scoped preference restoration, and server-held renewal succeeded. |
| User deletion and old-session denial | Passed in development | The product owner permanently deleted the synthetic Auth0 user profile and confirmed its existing application session expired and could not regain protected API access. A later Google SSO login created a new Auth0 profile/session; continuity of the upstream subject was not inspected. |
| Reprovisioned identity isolation | Passed in development | Profile persistence resolves the exact issuer and subject, never email. Its PostgreSQL integration proves same-email/different-subject isolation, and an aggregate-only check after Google SSO reprovisioning confirmed the current internal user had no preference row while multiple distinct subjects existed for the same synthetic email. No email or subject value was inspected. |
| Web passkey enrollment and sign-in | Passed in development | A disposable synthetic database user completed progressive passkey enrollment and a fresh private-browser passkey transaction. The passkey remained valid after the separate MFA registration was reset. The credential is development-only and must be re-enrolled when the final custom authentication domain is activated. See the [sanitized web identity evidence](../product/delivery/evidence/d0-auth0-web-passkey-mfa-recovery-2026-07-30.md). |
| Web MFA, reauthentication, and recovery | Passed in development | A controlled temporary `Always` policy proved TOTP enrollment, fresh password-plus-TOTP reauthentication, administrator-assisted MFA reset/re-enrollment, and recovery-code sign-in. No factor or recovery secret was retained. The policy then returned to `Never`; a fresh passkey transaction completed without redundant TOTP. Launch step-up policy and accountable approval remain open. |
| Provider/log-stream recovery | Passed in deployed development | With only the exact web application's two connections disabled, a fresh private login failed with generic guidance while both AWS services and heartbeat alarms remained healthy. Restoring the same count restored passkey login and a deployed durable operation. A separate exact gateway-log deny produced `OK → ALARM → OK` while the API and worker remained healthy; the product owner received both notifications, the deny was absent afterward, and Terraform reported no drift. See the [sanitized recovery evidence](../product/delivery/evidence/d0-development-provider-log-recovery-2026-07-30.md). |
| Expo public-client boundary | Passed locally; provider run deferred to D6 | The Native Application shell compiles and its tests prove fail-closed exact-audience configuration and sanitized errors. Auth0's native SDK owns system-browser PKCE and secure OS credential storage. This is preparation, not provider/device evidence. |
| Extension public-client boundary | Source assurance and initial Edge login pass; full provider run open | The dedicated Native Application has the exact installed-Edge callback and least-privilege user-delegated API grant. The actual MV3 protocol tests exact authorization/state/PKCE exchange, cancellation before exchange, refresh rotation and rejected replay behavior, automatic near-expiry renewal, logout/revocation, and fail-closed local clearing. Tokens remain in trusted-context session storage; fixed UI errors disclose no token, identity, provider body, or unknown exception. A configured build passes without provider page permissions, and an unconfigured build fails closed. |

## Open provider and device evidence

| Check | State | Required next evidence |
|---|---|---|
| Mobile PKCE, refresh, logout, cancellation | Deferred to D6 | Provision the dedicated Native Application and execute the Android/iOS provider and device matrix when mobile implementation begins. This no longer blocks the web-focused D0 exit. |
| Extension PKCE, refresh, logout, cancellation | Edge login passed; matrix open | Repeat the bounded sequence below in installed branded Chrome and Edge using only a disposable synthetic identity. Both exact extension callback/logout URLs must be separately allowlisted if the browser-generated IDs differ. |
| Refresh-token replay detection | Source behavior passed; live extension open; mobile deferred to D6 | The actual client module preserves the last valid session when a rejected refresh cannot replace it. With a disposable installed session, rotate once, replay only the invalidated token through an approved transient harness, and prove the family requires reauthentication without recording either token or raw Auth0 event. Repeat for mobile in D6. |
| Current-device/all-device revocation | Source behavior passed; live extension open; mobile deferred to D6 | The actual client revokes before provider logout and always clears local session, pending queue, capture, and receipts. Prove current-client logout and administrative grant revocation in both installed browsers, retaining only pass/fail, timestamp, browser, and final signed-in state. |
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

## D2 installed public-client manual matrix

Use only the configured ignored development build and a disposable synthetic identity. Do not open,
copy, print, screenshot, or retain browser storage, authorization codes, tokens, cookies, email
addresses, provider subjects, client IDs, tenant logs, or raw callback URLs. Before each browser,
confirm its generated callback/logout URL is registered only on the dedicated extension Native
Application and that the user-delegated API grant contains exactly `profile:read`, `profile:write`,
`jobs:read`, `jobs:write`, and `jobs:contribute`.

1. Reload the configured unpacked build. With the extension signed out, begin **Sign in** and close
   the provider window. The extension must remain signed out and show the fixed cancellation
   guidance; no queued intent may be delivered.
2. Start **Sign in** again and complete the disposable account flow. The extension must report
   **Signed in** and expose **Refresh session** only when a rotating refresh token is available.
3. Select **Refresh session** twice. Both rotations must finish signed in, retain the same local
   account fence, and expose no credential or provider response. The source suite independently
   proves that each returned rotating token replaces the preceding token.
4. In the approved transient replay harness, submit only the first invalidated refresh token once.
   Auth0 must reject it and require reauthentication for that token family. Destroy the transient
   values immediately; record only rejection and final signed-in/signed-out state.
5. Sign in again if required, then select **Sign out**. Provider revocation/logout must finish with
   the extension signed out and local capture, pending items, account-held items, and receipts
   cleared. A protected delivery action must require sign-in again.
6. Sign in once more, revoke the disposable identity's extension authorization in Auth0, and choose
   **Refresh session**. Renewal must fail with fixed reauthentication guidance and no provider
   detail. Remove the disposable identity after both browsers complete.

Run the sequence once in branded Chrome and once in branded Edge. Record all outcomes in this
existing document only—do not create a second D2 Auth0 evidence document. For each row retain only
the UTC timestamp, browser name/version, cancellation pass, login pass, two-refresh pass, replay
rejected, logout/local-clear pass, administrative-revocation pass, and final signed-out state.

Web passkey/MFA/recovery conformance used a disposable database user and development-domain
credential. The final custom authentication domain, sensitive-action step-up policy, and
accountable approval must be complete before real users; the web development result does not
substitute for the D6 mobile recovery and lost-device matrix.

The Auth0 deletion result proves provider-identity deletion and old-session denial only. It does
not claim that ApplyDash's future user-initiated durable deletion workflow has erased internal
records, backups, objects, analytics queues, or every subprocessor; that product-wide capability
and its accountable approval remain pending.
