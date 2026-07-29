# ADR-002: Provider-Neutral OIDC Authentication

Status: Accepted; provider selected by ADR-012
Date: 2026-07-28

## Context

Web, mobile, and extension clients require a managed identity system, but the provider is not yet
selected.

## Decision

Depend on standards: OIDC discovery, authorization code with PKCE, issuer/audience validation,
JWKS rotation, short-lived access tokens, explicit scopes, and revocation-aware sessions. Resolve
`issuer + subject` to an internal UUID. Test signers are constructible only under `NODE_ENV=test`;
deployed readiness requires a real issuer.

## Consequences

Clients and domain data do not depend on a vendor user ID. D0 cannot close until the managed
provider passes the web and shared verifier/lifecycle conformance required by the authenticated
foundation. Each public client must pass its complete provider, revocation, and device/browser
matrix in its owning delivery before that client releases: extension in D2 and mobile in D6.

## Delivery-sequencing amendment — 2026-07-29

ADR-012 selected Auth0. The product owner subsequently made D0 web-focused and deferred real mobile
Native Application provisioning and device conformance to D6. This sequencing change preserves the
provider-neutral contract and all release controls.
