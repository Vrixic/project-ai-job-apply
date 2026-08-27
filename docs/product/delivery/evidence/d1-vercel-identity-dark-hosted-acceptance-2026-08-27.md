# D1 Vercel identity-dark hosted acceptance — 2026-08-27

## Outcome

The isolated candidate and moderation-admin presentation projects passed the bounded protected-host
acceptance against exact clean source `4ec8f810c9ae69ed262c99be7ffeb876fb1eff65`. Both immutable
production deployments were `READY`, targeted `iad1`, remained behind Vercel deployment
protection, kept public indexing disabled, and kept admin identity activation disabled.

The accepted deployment aggregates are:

| Surface | Deployment | Identity mode | Route statuses | Observation SHA-256 |
|---|---|---|---|---|
| Candidate | `dpl_J7AGgMc1N2DPyqotLb82c6vXHD8r` | `identity-dark` | `200`, `404`, `503` | `7bcda94bc14fa5308d4c3c114cb8e19c9dbe523b70b73bce351a7ae308b35991` |
| Admin | `dpl_H4CZQ4X4YrHunG92Sh7HaUZFDpLD` | `identity-dark` | `200`, `404`, `503` | `96ee15a9670a5c62180cf0a4da5161687b1415ba89ad03d68c5db412ae167fa3` |

Direct unauthenticated requests to both immutable deployment origins returned protection redirects.
The reviewed capture used the provider-authorized protection bypass only for the fixed route matrix;
it discarded all response bodies, cookies, and tokens.

## Aggregate route and header result

Both roots returned `200` with a `no-store` cache directive. Both fixed generated-unknown routes
returned `404` without `no-store`. The candidate entitlement BFF and generated-synthetic admin
moderation POST both returned sanitized `503` responses with `no-store`, proving fail-closed
identity-dark behavior rather than managed authentication.

The authorized capture procedure and reviewer attest that the admin probe used `POST`,
`Content-Type: application/json`, and the strict generated-synthetic request defined by the
runbook. The retained aggregate schema does not encode method, content type, or request shape, so
the aggregate verifier alone does not mechanically prove those procedural facts.

Both roots emitted the exact source-owned transport, content-type, frame, referrer, permissions,
opener, and content-security headers required by the operator. Candidate emitted the exact crawler
header `X-Robots-Tag: noindex`; admin emitted `X-Robots-Tag: noindex, nofollow, noarchive`.
Aggregate retention counters
for tokens, cookies, response bodies, and restricted-value matches were all `0`.

## Scope and remaining gates

This closes only the exact-source protected deployment and fixed identity-dark route/header matrix.
It does not prove candidate or admin login, managed-OIDC authorization, authenticated feature
behavior, public crawlability or indexing, public abuse/load/lifecycle/cache behavior, moderation
authority, log review, assistive-technology accessibility, or accountable security/privacy/product
acceptance. Those gates remain open, and Phase 1 remains `In progress`.
