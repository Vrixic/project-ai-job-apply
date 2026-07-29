# Web Application

The primary candidate experience: onboarding, profile management, job discovery, application review, technical history through confirmed submission, outreach, billing, settings, and crawlable public job pages.

## Planned subfolders

- `app/` — Next.js routes, layouts, server components, and route handlers.
- `features/` — Product modules such as jobs, applications, profile, and billing.
- `components/` — Web-only composed components.
- `lib/` — Generated API clients, session helpers, and browser-safe utilities.
- `public/` — Static assets.
- `tests/` — Unit, accessibility, integration, and browser tests.

The web app orchestrates presentation only. Long-running preparation and submission work is started through backend APIs and displayed as durable workflow state.

## Phase 0 implementation

The initial responsive route restores and saves owner-scoped target roles, locations, and work
mode, then polls the durable readiness operation. A returning authenticated candidate sees the
last persisted preference set rather than presentation defaults. It displays the unresolved
identity-provider gate and never enables a production test-auth bypass.

Auth0 sessions are held by the Next.js server boundary. The browser calls narrow `/api/platform`
BFF routes, which attach an access token server-side and forward only approved headers to the
gateway. Configure the isolated development tenant through the
[development runbook](../../docs/security/auth0-development-runbook.md); never expose tokens
through `NEXT_PUBLIC_*` variables or browser storage.

While running through `next dev`, an authenticated synthetic user also sees a development-only
session-renewal conformance control. It forces the server-held token set to refresh and returns
only a sanitized pass or reauthentication-required result. The route returns `404` outside the
local development runtime and rejects cross-origin requests.

Authentication callback failures redirect to an allowlisted local error state. Provider-controlled
error descriptions are never rendered, while blocked or unavailable accounts receive a generic
recovery message.

Presentation branding comes from `@ai-job-apply/config/brand` and can be overridden at build time
with `NEXT_PUBLIC_PRODUCT_BRAND_NAME` and `NEXT_PUBLIC_PRODUCT_BRAND_DOMAIN`. The domain value is
descriptive only until ownership and public-brand approval are recorded; API and web origins use
separate configuration.
