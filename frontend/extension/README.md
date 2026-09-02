# Browser Extension

This directory contains the Manifest V3 Chrome/Edge client for explicit current-tab job capture.
Its Phase 2 source is implemented as a **synthetic, default-dark release candidate**. Greenhouse,
Lever, and Ashby detection is disabled until D2-011 supplies authorized sanitized fixtures and
separate QA representativeness acceptance. The build is not approved for real candidate use,
public contribution, or browser-store distribution.

## Implemented source boundary

- A popup and side-panel product shell with separate **Save privately** and
  **Contribute selected fields** actions.
- Auth0 public-client authorization code + PKCE, rotating refresh, revocation, and tokens confined
  to trusted `chrome.storage.session` contexts.
- Explicit `activeTab` inspection through `chrome.scripting.executeScript`; there are no persistent
  content scripts or provider host grants.
- Exact provider-domain adapters for Greenhouse, Lever, and Ashby behind a version/domain/provider
  policy whose accepted default enables no provider.
- A strict structured allowlist: canonical HTTPS URL, provider, adapter version, timestamp, title,
  company, location, description, and external job ID. Text is bounded and stripped of markup and
  control characters; URLs reject credentials, fragments, trackers, and local/private targets.
- Field-level contribution preview and removal. Required source identity fields are visible and
  cannot be silently removed. Private save never implies contribution approval.
- A bounded-attempt persistent local queue with one stable client intent/Idempotency-Key,
  exponential retry, service-worker restart recovery, login-session fencing, expiry, and explicit
  stopped/all-item removal. Explicit logout clears both the queue and last capture. Tokens are
  never included in UI messages or local pending records.
- An exact background-only HTTPS API origin. Contribution transport first targets the ADR-028
  Profile consent grant and then `POST /v1/jobs/contributions`. It maps only selected fields,
  uses shared canonical digest inputs, accepts only exact `no-store` server receipts, persists the
  server-issued consent across ambiguous contribution retries, and uses separate stable
  idempotency keys. Private save independently sends the exact generated
  `POST /v1/saved-job-captures` shape, uses its own stable idempotency key, and requires an exact
  non-cacheable acknowledgement before removing the queued intent.

The normal path never retains or uploads raw DOM, page HTML, browsing history, cookies, request
headers, form values, authentication material, or private notes. No telemetry provider is active.

## Manifest permissions

- `activeTab` — temporary access only after the candidate presses **Inspect current tab**.
- `scripting` — executes the self-contained structured field reader in that selected tab.
- `identity` — launches the Auth0 system-browser flow.
- `storage` — session credentials and the sanitized pending queue.
- `alarms` — resumes bounded pending delivery after worker suspension.
- `sidePanel` — exposes the same review surface as the popup.

The generated manifest contains no `history`, `cookies`, `webRequest`, `<all_urls>`, provider host,
or remote-code permission. Its only optional generated hosts are the exact configured Auth0 tenant
and API origin.

## Development

Create a separate Auth0 Native Application for this public client. It has no client secret. Copy
`.env.example` to `.env.local` and set the public tenant, client ID, audience, and exact HTTPS API
origin. Saving or contributing additionally requires `EXTENSION_PENDING_RETENTION_HOURS` to be an
integer from 1 through 720. Source selects no live default: accountable review must select the
duration within the enforced 30-day ceiling.

Contribution delivery also requires `EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION` to equal the
accountably selected server value. No value is selected in source or `.env.example`; absence keeps
delivery off.

Then run:

```powershell
pnpm --filter @ai-job-apply/extension typecheck
pnpm --filter @ai-job-apply/extension test
pnpm --filter @ai-job-apply/extension build
```

Load `frontend/extension/dist` as an unpacked extension. Register the generated extension ID's
exact callback/logout URL in the development Auth0 Native Application:

```text
https://EXTENSION_ID.chromiumapp.org/auth0
```

The access grant must include `jobs:read`, `jobs:write`, and the dedicated `jobs:contribute` scope
in addition to the existing profile scopes. A missing or malformed identity/API configuration
fails closed. Even with valid configuration, current provider capture remains disabled by
`DEFAULT_DARK_POLICY` until its external evidence gate passes.

## Remaining activation gates

- Generated API types and accepted server contracts, including private source resolution.
- Authorized provider-derived fixtures and independent representative-variant acceptance.
- Dedicated extension Auth0 Chrome/Edge conformance.
- Accountable UGC, permission, privacy, security, accessibility, and store approval.
- Final archive, malicious-page, offline/replay, deployed rollback, alert, and kill-switch evidence.

Synthetic detector unit tests prove only local invariants. They are not provider evidence and do
not make the extension live-ready or store-ready.
