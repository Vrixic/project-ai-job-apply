# Auth0 Development Tenant Runbook

- Status: Web client and web identity lifecycle active; provider/public-client conformance in progress
- Last updated: 2026-07-30
- Scope: Isolated development only

This runbook configures the development tenant selected by
[ADR-012](../adr/012-auth0-initial-managed-identity.md). It deliberately excludes production
branding, a custom domain, production passkeys, and real candidate accounts.

## Dashboard bootstrap

Use an Auth0 administrator protected by MFA. Do not share dashboard credentials, MFA codes,
client secrets, or tokens in chat, issues, screenshots, or repository files.

### Platform API

Create **Applications → APIs → Create API** with:

| Setting | Development value |
|---|---|
| Name | `ApplyDash Platform API Development` |
| Identifier | `ai-job-apply-api` |
| Signing algorithm | `RS256` |
| Token lifetime | `600` seconds |
| Allow offline access | Enabled for the server-held web session |

Add the permissions `documents:read`, `documents:write`, `jobs:read`, `jobs:write`,
`jobs:contribute`, `jobs:moderate`, `profile:read`, and `profile:write`. Keep RBAC and access-token permission claims
disabled: the gateway enforces exact OAuth scopes, the candidate and moderation clients receive
disjoint per-application grants, and the gateway derives a non-reversible opaque moderation audit
identifier instead of persisting raw identity-provider claims.

D3 Applications: the permissions `applications:read` and `applications:write` are defined on the development API and granted per application (owner statement 2026-09-18; not yet verified with a minted token). The [D3 rollout](../../infrastructure/runbooks/deployments/d3-applications-development-rollout.md) lists the acceptance that proves them. The web app requests them only when `AUTH0_APPLICATIONS_SCOPES=enabled`, so enable that only after the grant is in place. A real sign-in on 2026-09-19 confirmed the Applications scopes reach the Gateway (create 201). Grant them under **Application Access, User Delegated Access** for `ApplyDash Web Development`, alongside the six existing scopes. **Never enable RBAC or access-token permissions to do this:** with RBAC on the token carries only permissions assigned to the user, the existing scopes disappear, and API Gateway rejects every call (the web app shows a generic 503). The API Gateway `$default`
JWT authorizer passes a token that carries any one listed route scope, so an Applications token must also
carry an existing scope such as `profile:read`; the Gateway then enforces the exact `applications:*` scope.

Set the API's **Settings → Application Access Policy → User-Delegated Access** to **Per-app
authorization**. In **Application Access**, add or edit `ApplyDash Web Development`, grant only
user-delegated access, and allow `documents:read`, `documents:write`, `jobs:read`, `jobs:write`,
`profile:read`, and `profile:write`. Explicitly exclude `jobs:moderate`. Do not grant
client access: the web application acts only on behalf of its authenticated user and does not use
the Client Credentials flow. Update this per-application grant whenever the requested API scope
set changes; defining a permission on the API does not expand an existing client grant.

### Regular Web Application

Use the existing `ApplyDash Web Development` Regular Web Application and set:

| Setting | Exact value |
|---|---|
| Allowed callback URLs | `http://localhost:3000/auth/callback` |
| Allowed logout URLs | `http://localhost:3000` |
| Allowed web origins | `http://localhost:3000` |
| Token endpoint authentication | Client secret sent as POST |
| Grant types | Authorization Code and Refresh Token |

Do not add wildcards. Configure the development web client's refresh tokens as follows:

| Refresh-token setting | Development value |
|---|---|
| Rotation | Enabled |
| Rotation overlap period | `5` seconds |
| Absolute expiration | Enabled; `2592000` seconds (30 days) |
| Inactivity expiration | Enabled; `604800` seconds (7 days) |

The five-second overlap tolerates a narrowly concurrent server retry without creating a broad
replay window. Do not enable Resource Owner Password, Implicit, Device Code, or other unused
grants.

The application requests:

```text
openid profile email offline_access documents:read documents:write jobs:read jobs:write profile:read profile:write
```

Enable only the development database connection for this client. Universal Login remains the
credential boundary; the platform must never collect an Auth0 password.

### Moderation Regular Web Application

Create a separate `ApplyDash Moderation Development` Regular Web Application. Use callback
`http://localhost:3001/auth/callback`, logout/web origin `http://localhost:3001`, authorization
code only, no refresh-token grant, and no wildcard. In the Platform API's per-app authorization,
grant this client user-delegated access to `jobs:moderate` only. Do not grant candidate, document,
profile, or machine-to-machine scopes. The application requests exactly:

```text
openid profile jobs:moderate
```

Assign only accountable synthetic development moderators protected by MFA. Configure its secrets
with `scripts/configure-auth0-admin-local.ps1`; the operator refuses candidate web client ID or
client-secret reuse, generates a distinct session secret, writes only the ignored admin environment
file, and prints no secret. This setup enables local synthetic acceptance only and is not a
production admin access approval.

```powershell
.\scripts\configure-auth0-admin-local.ps1 -Auth0Domain "YOUR_TENANT.us.auth0.com" -ClientId "YOUR_DEDICATED_MODERATION_CLIENT_ID" -PlatformApiBaseUrl "https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com"
```

Enter the dedicated moderation client secret only at the secure prompt. Do not pass it on the
command line or copy it into evidence.

## Local secret configuration

From the repository root, run:

```powershell
.\scripts\configure-auth0-local.ps1 `
  -Auth0Domain "YOUR_TENANT.us.auth0.com" `
  -ClientId "YOUR_REGULAR_WEB_APPLICATION_CLIENT_ID"
```

Enter the client secret only at the secure prompt. The script generates a fresh cookie-encryption
secret and writes:

- `frontend/web/.env.local` for the server-only Auth0 SDK and BFF; and
- `.env` for the gateway's exact OIDC issuer and local dependencies.

Both files are gitignored. The script refuses to replace an existing web environment file unless
`-Force` is explicitly supplied. Never copy these values into `.env.example`.

## Local acceptance

Start local dependencies, migrate, and run the gateway, worker, and web application:

```powershell
.\scripts\start-local.ps1
pnpm --filter @ai-job-apply/profile-service build
pnpm --filter @ai-job-apply/profile-service db:migrate
pnpm dev
```

Then verify with a synthetic development account:

1. Open `http://localhost:3000`.
2. Create the account through Universal Login and complete email verification.
3. Save job preferences and confirm the readiness operation reaches `succeeded`.
4. Log out and confirm the platform BFF returns `401` for protected calls.
5. Log in again and select **Verify session renewal** in the development conformance panel. Record
   the sanitized success state; the browser must not receive token material.
6. Revoke the application's authorization from the Auth0 user record, return to the still-open
   local session, and select **Verify session renewal** again. Record the sanitized
   reauthentication-required state. This forced server-side renewal avoids waiting for the
   current access token to expire while proving the revoked grant cannot renew.
7. Block the Auth0 user, end the Auth0 session through the product logout route, and attempt to log
   in again. Confirm authentication fails and the application shows only its generic account
   unavailable/blocked recovery state; provider-controlled callback descriptions must not render.
8. Unblock only to test recovery, then log in successfully and confirm the owner-scoped saved
   preferences return. Delete the synthetic account only when beginning the separate deletion and
   old-session-denial check.
9. With the local web server routed to the deployed development gateway, complete a readiness
   workflow as synthetic account A and select **Arm cross-user isolation check**. Log out, sign in
   as a distinct synthetic account B, and select **Run check as this account** within 15 minutes.
   The check passes only when the deployed owner-scoped operation route returns `404`. A same-user
   retry is rejected before calling the gateway; no token, identity, operation identifier, or
   private response body is returned to the browser or retained as evidence.
10. After adding a new API permission, log out and sign in again, then select **Verify job-read
    authorization**. The check passes only when the server-held access token reaches the deployed
    job route and receives `404` for the reserved synthetic identifier. A `403` means the fresh
    session is missing `jobs:read`; no token or upstream body is returned to the browser.

### Deployed Lambda ownership conformance

Start the local BFF against the selected environment's steady-state serverless runtime. Omit
`-Environment staging` for development:

```powershell
  .\scripts\start-deployed-web-conformance.ps1 `
    -Environment staging
```

The launcher fails closed unless the ECS application inventory is empty, the public API invokes an
immutable environment-named Lambda alias, the JWT authorizer exactly matches the ignored local
issuer/audience, durable triggers are enabled, bounded concurrency matches the environment, and
health/access returns `200/200/401`.

Repeat step 9 with two distinct synthetic accounts. Account A must save harmless preferences,
reach `succeeded`, and confirm persistence after reauthentication. Account B must receive only the
sanitized cross-user isolation pass. This proves the deployed API/database ownership path without
exposing an access token or enabling a fallback runtime.

Capture no tokens, cookies, secrets, complete email addresses, or provider subjects. Record only
timestamps, expected/actual results, sanitized screenshots, and correlation IDs.

## Web passkey, MFA, and recovery conformance

Use a disposable synthetic database user, not a dashboard administrator or social identity.
Enable New Universal Login, Identifier First, password fallback, and one database connection's
passkey method. Configure the passkey challenge for both explicit-button and autofill use, with
progressive and local enrollment enabled.

For the controlled MFA interval:

1. Enable TOTP and recovery-code factors.
2. Temporarily set the tenant MFA policy to `Always`.
3. Enroll the synthetic user with password plus TOTP and retain the recovery code outside the
   repository, terminal history, screenshots, and evidence.
4. Prove a fresh password-plus-TOTP transaction.
5. Prove the lost-code path by resetting only that user's MFA registration in **User Management →
   Users → Actions → Reset Multi-factor**, then re-enroll and securely retain the new code.
6. Prove a fresh password transaction can use the recovery-code path instead of the authenticator.
7. Prove the database passkey still authenticates after the MFA reset.
8. Observe whether `Always` adds TOTP after the passkey, then return the development tenant policy
   to `Never` and prove a fresh passkey transaction completes without redundant TOTP.

Keep passkey, TOTP, and recovery-code capabilities enabled after the test. The restored `Never`
policy is for the synthetic-only development tenant; it is not the launch policy. Before real
users, implement and approve narrowly scoped reauthentication/step-up behavior for sensitive
actions and elevated-risk sessions. Activation of the final custom authentication domain requires
fresh passkey enrollment.

## Public-client conformance

Create two separate **Native Applications**, one for Expo and one for the browser extension. Public
clients have no client secret. Enable Authorization Code and Refresh Token grants, rotating and
expiring refresh tokens, and only the development database connection.

For the browser extension, add or edit its entry under the Platform API's **Application Access**
tab, grant only user-delegated access, and allow `profile:read`, `profile:write`, `jobs:read`,
`jobs:write`, and `jobs:contribute`. Do not grant client access. Defining `jobs:contribute` on the
API does not automatically expand an existing per-application grant.

Provision each application only when its owning delivery begins. Extension conformance belongs to
D2; mobile Native Application provisioning and device conformance belong to D6 and do not block
the web-focused D0 exit.

Write the ignored public settings with:

```powershell
.\scripts\configure-auth0-public-clients.ps1 `
  -Auth0Domain "YOUR_TENANT.us.auth0.com" `
  -MobileClientId "YOUR_MOBILE_NATIVE_CLIENT_ID" `
  -ExtensionClientId "YOUR_EXTENSION_PUBLIC_CLIENT_ID"
```

During sequential conformance, configure mobile independently with `-MobileOnly`, or the extension
with `-ExtensionOnly`. Neither mode reads or overwrites the other client's ignored configuration.

The script prints the exact mobile callbacks. Build and load the extension to obtain its exact
`https://EXTENSION_ID.chromiumapp.org/auth0` callback. Add each URL to only its owning
application's callback and logout allowlists; never use a wildcard or copy the Regular Web
Application secret into either client.

Run the mobile shell with a custom Expo development build because the Auth0 native SDK is not
available in Expo Go. Build and load `frontend/extension/dist` unpacked for the extension flow.
For each client, record login, cancellation, renewal, logout, and post-revocation behavior in the
[sanitized evidence index](auth0-development-conformance.md).

## Evidence status

### Native-material SPA (retired by ADR-050)

[ADR-050](../adr/050-generate-then-apply-flow.md) replaces the popup sign-in with a BFF read that
uses the candidate's confidential web session, so no separate SPA registration, popup callback
origin or `NEXT_PUBLIC_NATIVE_AUTH0_*` variable is needed. The web deployment needs only the
server-side `NATIVE_MATERIAL_BASE_HOST` (the reviewed native DNS/TLS base host). The owner may
retire the previously saved SPA application after the release; do not reuse it for other purposes.
Live native acceptance of the web session's token (exact issuer, audience, scope, owner), expiry and
cross-owner refusal remains open. See [ADR-044](../adr/044-browser-native-material-identity.md) for
the superseded design.

Public discovery, web login/callback/logout, real API audience/scopes, identity mapping, durable
profile operation, forced web renewal, and web grant revocation passed in isolated development.
Local verifier coverage also passes algorithm/signature/claim rejection, overlapping signing-key
rotation, warm-cache JWKS outage behavior, and cold-start failure. Web user
block/recovery/provider-deletion and old-session denial pass; product-wide deletion reconciliation
is not claimed. Deployed two-account operation isolation also passes: the second account received
only the sanitized success state after the owner-scoped route returned `404`. Web passkey
enrollment/sign-in, password-plus-TOTP reauthentication, MFA reset/re-enrollment, recovery-code
use, and the restored low-friction development policy pass with a disposable synthetic user.
Extension transactions, extension refresh-token replay/device revocation, deployed outage/log
streaming, and on-demand staging replay remain open for their owning gates. Real mobile
transactions and device-specific lifecycle evidence are deferred to D6. See the
[development conformance evidence](auth0-development-conformance.md) for the exact split.
