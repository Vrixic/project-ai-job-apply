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
- Exact provider-domain adapters for Greenhouse, Lever, and Ashby behind a separate reviewed
  build-time detector policy. It requires the exact extension version plus complete provider,
  page-variant, and domain maps; absence, malformed/extra fields, or any disabled dimension denies
  inspection. Source and the default-dark package enable no detector.
- Public contribution additionally requires a bounded Ed25519-signed capability policy fetched as
  JSON data from the exact API origin. The extension pins an explicit key-ID-to-SPKI map at build
  time, verifies the server-compatible canonical envelope, and independently checks global intake,
  exact extension version, provider, page variant, and domain. Unknown keys, invalid signatures,
  incomplete policies, received-invalid updates, future policies, and policies older than their
  signed expiry deny contribution. A verified cache can bridge a service-worker restart or network
  outage only until its signed expiry; it never enables private save or executes remote code.
- A strict structured allowlist: canonical HTTPS URL, provider, adapter version, timestamp, title,
  company, location, description, and external job ID. Text is bounded and stripped of markup and
  control characters; URLs reject credentials, fragments, trackers, and local/private targets.
- One field-level preview shared by the two explicit actions. Optional-field removal is honored by
  both private save and public contribution; required source identity fields remain visible and
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

Both session and local extension storage are restricted to trusted extension contexts before any
session, policy-cache, capture, or pending-queue access. The normal path never retains or uploads
raw DOM, page HTML, browsing history, cookies, request
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

It also requires `EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON`, a JSON object mapping each approved
lowercase key ID to that Ed25519 public key's base64url-encoded DER SPKI bytes. This is public key
material, not a secret, but source and the default-dark store package intentionally pin no live key.
The signed policy is read only from `/v1/extension/contribution-capability-policy` at the configured
HTTPS API origin. A received envelope may live for at most 24 hours; source selects no policy,
signing key, refresh interval, or activation value.

Page inspection and private capture use the independent `EXTENSION_DETECTOR_ACTIVATION_JSON`
build-time policy. Its exact shape is `schemaVersion`, a reviewed `revision`, `extensionVersion`,
and complete boolean `enabledProviders`, `enabledVariants`, and `enabledDomains` maps covering only
the three source adapters and five domains documented above. This setting contains no executable
adapter or remote URL and does not authorize public contribution. A signed contribution disable
therefore cannot disable an otherwise reviewed private-save path, while an absent detector policy
still keeps both current-page actions dark because there is no accepted page to save.

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
the absent detector activation policy until its external evidence gate passes. Private saved-page
transport is not controlled by the public-contribution policy and remains independently available
whenever its own identity, API, retention, and detector gates pass.

## Remaining activation gates

- Generated API types and accepted server contracts, including private source resolution.
- Authorized provider-derived fixtures and independent representative-variant acceptance.
- Dedicated extension Auth0 Chrome/Edge conformance.
- Accountable UGC, permission, privacy, security, accessibility, and store approval.
- Final archive, malicious-page, offline/replay, deployed rollback, alert, and kill-switch evidence.

Synthetic detector unit tests prove only local invariants. They are not provider evidence and do
not make the extension live-ready or store-ready.
