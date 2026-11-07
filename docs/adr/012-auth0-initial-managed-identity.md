# ADR-012: Auth0 as the Initial Managed Identity Provider

Status: Accepted
Date: 2026-07-28
Supersedes: The open provider-selection portion of [ADR-002](002-provider-neutral-oidc.md);
ADR-002's provider-neutral contract remains in force

## Context

The platform needs managed identity for Next.js web, Expo mobile, and a Manifest V3 browser
extension. The accepted boundary requires OIDC discovery, authorization code with PKCE,
issuer/audience validation, JWKS rotation, short-lived access tokens, explicit scopes,
revocation-aware sessions, passkeys/MFA, and internal identity based on `issuer + subject`.

Auth0, Amazon Cognito, Clerk, and WorkOS were compared. Auth0 has the strongest direct fit for the
existing standards-first verifier and offers cohesive web/mobile SDKs, Universal Login,
passkeys/MFA, refresh-token rotation, reuse detection, and environment separation. Cognito is the
preferred fallback if Auth0's commercial or operational terms become unsuitable.

## Decision

Use Auth0 as the initial managed OIDC provider, subject to provider, legal/privacy, security, and
deployed conformance gates.

- Use isolated Auth0 tenants for development, staging, and production.
- Register separate clients for web, mobile, and browser extension trust boundaries.
- Use Universal Login and authorization code with PKCE for public clients.
- Keep the API audience stable as `ai-job-apply-api`; do not derive it from the presentation brand.
- Validate exact issuer, audience, signature, expiry, and approved algorithms at the gateway.
- Resolve the Auth0 `iss + sub` pair to an internal UUID. Auth0 identifiers must not become domain,
  API, event, billing, or public identifiers.
- Keep candidate profile and product data in platform-owned stores. Auth0 receives only the
  minimum identity and session data required for authentication.
- Use short-lived access tokens, rotating refresh tokens, reuse detection, explicit logout and
  revocation, and narrowly scoped Management API credentials held only by authorized backends.
- Keep production custom-domain and durable passkey enrollment blocked until the public domain is
  owned and approved under D6-012.
- Do not activate real candidate processing until the Auth0 subprocessor and security/privacy
  gates are approved.

The configuration and conformance requirements are defined in
[the Auth0 baseline](../security/auth0-configuration-baseline.md).

## Consequences

Auth0 is a selected dependency, but application ownership remains provider-neutral. The existing
`identity.external_identities` mapping can associate more than one external identity with an
internal user, allowing a controlled future migration without moving candidate-domain records.

Changing providers still has user-visible costs:

- active Auth0 sessions and refresh tokens will end;
- users must authenticate to both the existing and replacement identity before identities are
  linked; email equality alone is never sufficient;
- password credentials might require just-in-time migration or password reset;
- passkeys may require re-enrollment when the relying-party domain changes; and
- a dual-provider migration window, deletion reconciliation, audit evidence, and rollback plan are
  required.

Provider configuration is not deployment or approval evidence. D0-010 requires the real
development web boundary and shared issuer, audience, key-rotation, ownership, lifecycle, and
failure-mode evidence needed by the authenticated foundation. Real public-client conformance is
required in the delivery that releases each client: extension evidence in D2 and mobile evidence in
D6. Each environment must replay the applicable matrix before it processes users or becomes a
release candidate.

### Delivery-sequencing amendment — 2026-07-29

The product owner narrowed current delivery to the web platform and deferred provisioning and
device-testing the dedicated mobile Native Application until D6. The locally verified Expo shell
remains architectural preparation, not provider evidence. This changes when mobile conformance is
performed; it does not relax any mobile identity or release control.

## Alternatives

- **Amazon Cognito:** Strong standards and AWS integration at much lower initial cost. Not selected
  initially because resource-bound `aud` tokens require a more constrained managed-login flow,
  detailed authentication activity logging requires Plus, several pool settings are immutable,
  and passkey/MFA policy combinations require more application-specific handling.
- **Clerk:** Excellent client and browser-extension SDKs. Not selected because its session model
  would create more vendor coupling than ADR-002 permits.
- **WorkOS AuthKit:** Attractive pricing and hosted authentication. Not selected because its
  current Expo/extension path and token/JWKS shape are a weaker match for the repository contract.

## Amendment: a session that cannot get an access token is ended (2026-11-07)

Owner report: the header showed the candidate signed in while job details failed with "Sign in
again", and only a manual sign-out fixed it. The web session is a cookie; the platform calls need
an access token (10 minutes in development) that the SDK refreshes with a rotating refresh token.
When that refresh fails, the cookie outlives the token, so the page is neither signed in nor signed
out. The BFF already answers `session_expired` for this case and only this case. The signed-in pages
now answer it by signing the candidate out through the existing sign-out (cleanup of temporary
application documents included), which lands on the signed-out page with a one-line reason. A plain
`authentication_required` is left to the page, because the account-deletion flow uses it to ask for
a recent sign-in. The BFF logs the SDK's short error code (never a token or a user) when a token
cannot be had, so the trigger (a lapsed or reused refresh token) can be told apart next time.
