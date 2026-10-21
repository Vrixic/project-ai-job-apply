# ADR-044: Separate browser identity for native material reads

Status: Superseded by [ADR-050](050-generate-then-apply-flow.md) (2026-10-20): generated material is read through the authenticated BFF with no browser-held credential. Retained as the record of the earlier popup design.
Date: 2026-10-09

## Decision

The owner selected a separate in-memory Auth0 authorization-code/PKCE sign-in for browser-native
material reads. Use a separate public SPA registration, the existing `ai-job-apply-api` audience,
`openid applications:read`, exact HTTPS application origins and popup authorization. Never expose
the confidential web client's server-held tokens. This extends ADR-012 and implements the browser
boundary of ADR-038/040; it does not authorize provider retention or change their activation gates.

Instantiate Auth0 SPA SDK 2.26.0 directly with memory caching and refresh tokens disabled. Do not
use automatic session checks, silent renewal, redirect transactions or offline access. Open the
popup synchronously from the candidate's click, bound sign-in to 65 seconds, and fence late work.
The local credential lease ends at the earlier of ten minutes or the SDK-validated ID-token
expiry. Native authorization independently verifies the access token's issuer, audience, scope,
expiry and exact owner. Selecting a different Auth0 account fails closed at the native process.
Local disconnect clears this client; it does not claim to revoke the tenant-wide SSO session.

The authenticated BFF returns only current scalar packet/location metadata. A bearer token is
sent only to HTTPS port 8443 on a UUID allocation under the configured native material base host,
without cookies, redirects, referrers or caching. The allocation ID can differ from the original
generation ID. Verify closed response schemas, complete material references, content hashes,
original expiry and current scalar packet/location proof before and after each read. Bound reads
to 15 seconds and 512 KiB. Approval requires explicit review of both exact previews. Downloads
require current approval, format/media agreement and a verified byte count and SHA-256.

Discard page references and abort reads on disconnect, expiry, page exit, packet replacement,
cancellation and confirmed submission. Revoke download object URLs and clear owned byte buffers.
JavaScript strings are subject to garbage collection; this is logical disposal, not a physical
memory-erasure guarantee. Auth0's SDK may write an authentication marker cookie, but tokens and
generated content must never enter browser storage. Candidate-held downloads and employer copies
remain outside platform deletion.

## Activation and evidence

The UI defaults off. Only a fully configured `/jobs` workspace receives
`Cross-Origin-Opener-Policy: same-origin-allow-popups`, because strict `same-origin` severs
cross-origin popup communication. Every other route and unconfigured build retains the strict
policy. This permits the intentionally opened authentication popup to retain its opener; all
employer/source links retain `noopener noreferrer`. A synthetic cross-origin popup test exercises
the browser behavior; tenant/provider headers still require live acceptance.

A fixed same-origin BroadcastChannel withdrawal message clears other active material workspaces
when app sign-out starts and when the signed-out page mounts. It carries no identifiers or content
and writes no storage. Browsers without this coordination capability cannot connect material
access. This is local logical disposal, distinct from native-process withdrawal and provider SSO.

Inspect the existing separate SPA first, then verify exact Allowed Callback URLs,
Allowed Web Origins and Allowed Logout URLs for the deployed HTTPS web origin; no wildcards,
client secret or management token belongs in public variables. Set the public variables documented
in `frontend/web/.env.example` only after reviewing the native DNS/TLS/CORS configuration and
the managed release. Do not enable implicit grants or refresh-token/offline-access permissions.

Unit and Chromium tests use synthetic credentials and responses. They cannot establish live
Auth0 tenant settings, same-owner acceptance, native DNS/TLS/CORS, provider no-retention behavior,
remote writer settlement or all-copy disposal. Controlled sign-in/MFA and exact managed release
acceptance remain required. Independent D1 acceptance, including hosted admin, stays deferred.

On 2026-10-09, dashboard inventory found no SPA and reported an application limit. The owner
confirmed repurposing Default App as the separate native-material SPA. Saved settings show
Authorization Code only, the existing exact HTTPS candidate origin, RS256/OIDC conformance and
one user-delegated platform API scope, `applications:read`; machine and anonymous platform access
are zero. The inherited Management API user-delegated policy was inspected without a tenant-wide
change or new management grant. Configuration inspection does not establish live token exchange
or native acceptance. The material UI remains disabled.

SDK reference: [Auth0 SPA client](https://github.com/auth0/auth0-spa-js/blob/main/src/Auth0Client.ts).

Browser reference: [Chromium opener isolation](https://chromium.googlesource.com/chromium/src.git/+/master/docs/security/post-spectre-webdev.md).
