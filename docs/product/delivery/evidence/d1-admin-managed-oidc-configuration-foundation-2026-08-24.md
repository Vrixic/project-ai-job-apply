# D1 admin managed-OIDC configuration foundation — 2026-08-24

- Exact merged source: `ca454964164cc30b6450e484a92f7bd1ef5b47ea`
- Scope: dedicated local moderation-client configuration and operator guidance
- Auth0/AWS/data effect: none

## Outcome

The local D1 moderation client now has a guarded, one-command configuration path. The operator
writes only the ignored `frontend/admin/.env.local`, reads the dedicated client secret through a
secure prompt, generates a distinct 32-byte session secret, and prints no secret value.

```powershell
.\scripts\configure-auth0-admin-local.ps1 -Auth0Domain "YOUR_TENANT.us.auth0.com" -ClientId "YOUR_DEDICATED_MODERATION_CLIENT_ID" -PlatformApiBaseUrl "https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com"
```

The operator fails closed when the client ID or client secret matches the existing candidate-web
client. It also rejects multiline values, a noncanonical client ID, a domain containing a scheme or
path, and a platform API URL that is neither HTTPS nor HTTP loopback or that carries credentials,
query data, or a fragment.

The development runbook now matches the implemented admin client: authorization code only, no
refresh-token grant, and exact requested scopes `openid profile jobs:moderate`. Candidate,
document, profile, machine-to-machine, and offline access are excluded. The local admin README
links the same dedicated-client procedure.

## Verification

- PowerShell 7 parser: passed.
- Windows PowerShell 5.1 parser and refusal execution: passed.
- Non-loopback HTTP API-target refusal: passed.
- Candidate client-ID reuse refusal: passed.
- Candidate client-secret reuse refusal: passed without printing either secret.
- Ignored-output boundary: passed; no admin environment file was retained by testing.
- Admin tests: `7/7` passed.
- Admin typecheck: passed.
- `git diff --check`: passed.

## Delivery effect

This removes an unsafe manual-secret-copy path and corrects an `offline_access` contradiction in
the operating instructions. It does not create or modify an Auth0 application, grant
`jobs:moderate`, assign a moderator, prove MFA, host the admin UI, execute managed OIDC, authorize a
moderation policy, or accept D1-007. A tenant administrator must still create the separate Regular
Web Application and grant, and an accountable synthetic moderator must complete the browser flow.
