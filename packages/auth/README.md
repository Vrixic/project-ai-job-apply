# Authentication Helpers

Contains shared OIDC/session helpers for clients, gateway, services, extension, and privileged admin access.

## Planned subfolders

- `client/` — Web/mobile/extension sign-in and token handling.
- `server/` — Token verification and service identity.
- `authorization/` — Roles, attributes, scopes, and policy helpers.
- `sessions/` — Rotation, expiry, device, and revocation primitives.
- `admin/` — Break-glass and privileged-access controls.
- `testing/` — Synthetic identities and authorization fixtures.

This package contains no provider secrets and does not replace the profile service.

`createOidcVerifier({ issuer, audience, requireExpiration: true })` requires a signed expiration
claim for direct transports without an upstream JWT authorizer. It preserves the existing default
for current callers. Native material HTTPS reads select this strict mode and verify again after
asynchronous reads; production transport cannot inject a synthetic verifier.
