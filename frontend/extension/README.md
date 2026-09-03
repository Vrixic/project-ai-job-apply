# Browser Extension

This directory contains the Manifest V3 Chrome/Edge client for explicit current-tab job capture.
Its Phase 2 source is implemented as a **synthetic, default-dark release candidate**. Greenhouse,
Lever, and Ashby detection is disabled until D2-011 supplies authorized sanitized fixtures and
separate QA representativeness acceptance. The build is not approved for real candidate use,
public contribution, or browser-store distribution.

## Implemented source boundary

- A popup and side-panel product shell with one explicit **Add job to shared database** action
  after a field-level preview. The extension does not present a separate private-save action or a
  redundant approval checkbox.
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
  outage only until its signed expiry; it never enables contribution after expiry or executes
  remote code.
- A strict structured allowlist: canonical HTTPS URL, provider, adapter version, timestamp, title,
  company, location, work type, description, and external job ID. Text is bounded and stripped of
  markup and control characters; URLs reject credentials, fragments, trackers, and local/private
  targets. A work arrangement embedded in a combined location such as `Remote-NORAM` is separated
  into grounded work type `Remote` and location `NORAM`.
- One field-level preview for the explicit public-add command. Optional-field removal is honored;
  required source identity fields remain visible and cannot be silently removed. Pressing the add
  button is the user's instruction to enqueue only the selected public fields.
- A bounded-attempt persistent local queue with one stable client intent/Idempotency-Key,
  exponential retry, service-worker restart recovery, login-session fencing, expiry, and explicit
  stopped/all-item removal. Explicit logout clears both the queue and last capture. Tokens are
  never included in UI messages or local pending records.
- An exact background-only HTTPS API origin. Contribution transport records an immutable,
  digest-bound command authorization through the existing v1 Profile consent endpoint and then
  calls `POST /v1/jobs/contributions`. The authorization receipt is an audit, replay, attribution,
  and withdrawal control; it is not a claim that a public posting needs permission to be read. The
  transport maps only selected fields, accepts only exact `no-store` server receipts, persists the
  server-issued receipt across ambiguous retries, and uses separate stable idempotency keys. The
  backward-compatible private-capture transport remains implemented but is not exposed by the
  public-add-only extension surface.

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
origin. Adding a job additionally requires `EXTENSION_PENDING_RETENTION_HOURS` to be an integer
from 1 through 720. Source selects no live default: accountable review must select the duration
within the enforced 30-day ceiling.

Contribution delivery also requires `EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION` to equal the
accountably selected server value. No value is selected in source or `.env.example`; absence keeps
delivery off.

It also requires `EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON`, a JSON object mapping each approved
lowercase key ID to that Ed25519 public key's base64url-encoded DER SPKI bytes. This is public key
material, not a secret, but source and the default-dark store package intentionally pin no live key.
The signed policy is read only from `/v1/extension/contribution-capability-policy` at the configured
HTTPS API origin. A received envelope may live for at most 24 hours; source selects no policy,
signing key, refresh interval, or activation value.

Page inspection uses the independent `EXTENSION_DETECTOR_ACTIVATION_JSON`
build-time policy. Its exact shape is `schemaVersion`, a reviewed `revision`, `extensionVersion`,
and complete boolean `enabledProviders`, `enabledVariants`, and `enabledDomains` maps covering only
the three source adapters and five domains documented above. This setting contains no executable
adapter or remote URL and does not authorize public contribution. An absent detector policy keeps
current-page inspection dark because there is no accepted page to add.

Current-page inspection is a local-only explicit action and does not require sign-in or an API
origin. Adding the sanitized preview remains fail-closed unless the required identity, API,
retention, authorization-receipt, and capability gates pass.

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
the absent detector activation policy until its external evidence gate passes. The implemented
private saved-page API transport remains backward compatible but has no control in this extension
release candidate.

## Remaining activation gates

- Generated API types and accepted server contracts, including private source resolution.
- Authorized provider-derived fixtures and independent representative-variant acceptance.
- Dedicated extension Auth0 Chrome/Edge conformance.
- Accountable UGC, permission, privacy, security, accessibility, and store approval.
- Final archive, malicious-page, offline/replay, deployed rollback, alert, and kill-switch evidence.

Synthetic detector unit tests prove only local invariants. They are not provider evidence and do
not make the extension live-ready or store-ready.
