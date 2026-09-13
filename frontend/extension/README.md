# Browser Extension

This directory contains the Manifest V3 Chrome/Edge client for explicit current-tab job capture.
Its repository defaults remain a **synthetic, default-dark release candidate**. The configured
unpacked development candidate now enables the accepted Greenhouse, global-Lever and hosted-Ashby
variants on their four exact hosts; EU Lever and custom domains remain disabled. Development mode
avoids signed-policy renewal; the default distribution path remains signed-policy-bound.
The September 12 description correction verifies at state `338`, Gateway/scheduled/Trust
`66`/`26`/`20`, from source `dccbb65`, preserving the state-336 provider activation. The configured
extension is rebuilt: typecheck, all 337 unit tests, 137 focused capture/readiness tests, four
runtime readiness cases and five generated-sanitizer checks pass. Installed Ashby reload, preview and delivery remain
unconfirmed; a successful build is not installed acceptance. Initial installed Edge sign-in and
server acknowledgement are confirmed for the existing journey. The supplied global-Lever job is
user-confirmed published/accepted; its website detail/source journey remains unconfirmed.
Acknowledgement is not publication: independent provider verification and Trust acceptance still
apply. Existing reviewer authority is unchanged. Production, general candidate release, and
browser-store distribution are not approved. See the current
[Phase 2 register](../../docs/product/delivery/phase-2-extension-and-community.md) for live gates.

## Implemented source boundary

- Descriptions retain literal plaintext comparison symbols (`<`, `>`, `<=`, `>=`) after inert
  page extraction, including paired comparisons. The preview keeps its 12,000-character bound;
  tag-like starts (including incomplete/NFKC markup) remain unavailable. Other field guards,
  selected-payload hashes and already queued intents are unchanged. Jobs intake and independent
  verification are development-deployed with this client correction; see D2-060 in the Phase 2 register.

- A popup and side-panel product shell with one explicit **Add job to shared database** action
  after a field-level preview. The extension does not present a separate private-save action or a
  redundant approval checkbox.
- Auth0 public-client authorization code + PKCE, rotating refresh, revocation, and tokens confined
  to trusted `chrome.storage.session` contexts. Concurrent refreshes share one exchange; session
  generations and ordered storage commits reject obsolete responses. Explicit logout clears prior
  credentials before network completion, even if a newer sign-in is cancelled, without clearing
  a newer successful login.
- OAuth token and revocation requests refuse redirects and browser cookies, bypass caches, and
  have a ten-second whole-request deadline. Token bodies must be bounded UTF-8 JSON (64 KiB).
  An expired but refreshable session keeps its Refresh and Sign out controls visible; this never
  enables contribution delivery until authentication succeeds. Failures expose fixed messages,
  not token/provider bodies.
- Explicit `activeTab` inspection through `chrome.scripting.executeScript`; there are no persistent
  content scripts or provider host grants.
- Exact provider-domain adapters for Greenhouse, Lever, and Ashby behind a separate reviewed
  build-time detector policy. It requires the exact extension version plus complete provider,
  page-variant, and domain maps; absence, malformed/extra fields, or any disabled dimension denies
  inspection. Source and the default-dark package enable no detector.
- Default signed-mode public contribution additionally requires a bounded Ed25519-signed capability policy fetched as
  JSON data from the exact API origin. The extension pins an explicit key-ID-to-SPKI map at build
  time, verifies the server-compatible canonical envelope, and independently checks global intake,
  exact extension version, provider, page variant, and domain. Unknown keys, invalid signatures,
  incomplete policies, received-invalid updates, future policies, and policies older than their
  signed expiry deny contribution. A verified cache can bridge a service-worker restart or network
  outage only until its signed expiry; it never enables contribution after expiry or executes
  remote code. Opening the popup or explicitly inspecting a page rechecks delivery readiness in a
  warm worker: policy requests share one in-flight fetch, readiness requests have a 15-second
  cooldown, and each fetch has a 10-second deadline. No timer polls readiness or contribution
  status. This can recognize a renewed server policy without reloading the extension, signing in
  again, or resubmitting an acknowledged job; existing identity and preview gates still apply.
- `EXTENSION_DEVELOPMENT_CONTRIBUTIONS=true` selects a separate unpacked-development runtime.
  It never loads signing keys or a signed cache, requests the capability-policy endpoint, or checks
  a renewal/expiry clock. It accepts only extension `0.2.0` and defaults to Greenhouse
  `greenhouse-board-v1` on `boards.greenhouse.io` / `job-boards.greenhouse.io`. The optional
  `EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON` selects among fixed descriptors: Lever
  `lever-posting-v1` on `jobs.lever.co` / `jobs.eu.lever.co`, and Ashby `ashby-job-board-v1` on
  `jobs.ashbyhq.com`. Exact HTTPS domains and independent detector activation remain mandatory;
  listing a provider does not activate its detector or server registration. Authentication, API, retention, selected-field preview,
  command authorization, account fencing, retry limits and server authorization remain required.
  This client setting cannot enable a development-disabled server or authorize publication.
  The build is visibly labelled Development; store packaging refuses active development settings
  and development-marked artifacts. The default signed implementation remains unchanged.
- A strict structured allowlist: canonical HTTPS URL, provider, adapter version, timestamp, title,
  company, location, work type, description, and external job ID. Text is bounded and stripped of
  markup and control characters; URLs reject credentials, fragments, trackers, and local/private
  targets. A work arrangement embedded in a combined location such as `Remote-NORAM` is separated
  into grounded work type `Remote` and location `NORAM`.
- One field-level preview for the explicit public-add command. Optional-field removal is honored;
  required source identity fields remain visible and cannot be silently removed. Pressing the add
  button is the user's instruction to enqueue only the selected public fields.
- A bounded-attempt persistent local queue with one stable client intent/Idempotency-Key,
  exponential retry, service-worker restart recovery, pseudonymous account fencing, expiry, and
  explicit stopped/all-item removal. The fence is a one-way digest of bounded Auth0 token identity
  claims: it remains stable when the same account reauthenticates, changes for a different account,
  and never stores the raw subject. Explicit logout clears both the queue and last capture. Tokens
  are never included in UI messages or local pending records.
- Delivery shares one in-flight dispatcher per session. Every consent/intake request and local
  receipt commit is session-fenced; short storage locks preserve concurrent additions and explicit
  removal without holding logout behind HTTP. Logout also clears contribution receipts. Late
  responses cannot restore cleared state or expose old-account receipts, and owner refreshes do
  not overwrite newer processing timestamps or Trust versions.
- An exact background-only HTTPS API origin. Contribution transport records an immutable,
  digest-bound command authorization through the existing v1 Profile consent endpoint and then
  calls `POST /v1/jobs/contributions`. The authorization receipt is an audit, replay, attribution,
  and withdrawal control; it is not a claim that a public posting needs permission to be read. The
  transport maps only selected fields, accepts only exact `no-store` server receipts, persists the
  server-issued receipt across ambiguous retries, and uses separate stable idempotency keys. The
  backward-compatible private-capture transport remains implemented but is not exposed by the
  public-add-only extension surface.
- Acknowledged jobs still waiting on independent verification can be cancelled explicitly without
  an existing Trust case or an enabled intake policy. The exact owner command ends publication
  authorization, uses one stable replay key, and keeps its receipt. Jobs already entering Trust
  require the existing withdrawal workflow instead. Owner requests refuse redirects, bound response
  bytes and whole-response time, and cannot restore a receipt after logout supersedes the request.

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

In default signed mode it also requires `EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON`, a JSON object mapping each approved
lowercase key ID to that Ed25519 public key's base64url-encoded DER SPKI bytes. This is public key
material, not a secret, but source and the default-dark store package intentionally pin no live key.
The signed policy is read only from `/v1/extension/contribution-capability-policy` at the configured
HTTPS API origin. A received envelope may live for at most 24 hours; source selects no policy,
signing key, background polling interval, or activation value. The local 15-second readiness
cooldown limits user-initiated requests; it does not extend signed validity. After renewal, wait
at least 15 seconds since the last check and press **Inspect current tab**, or reopen the popup.
Existing builds need one rebuild/reload to receive this readiness fix; subsequent policy renewals
do not require an extension reload.

For an explicitly authorized **unpacked development** installation, set
`EXTENSION_DEVELOPMENT_CONTRIBUTIONS=true`. Only exact `true` or `false` is accepted; absence selects
`false`. This mode needs no capability signing-key setting, remote policy fetch, expiry, or renewal.
Keep the independent detector, public identity/API, pending retention, and UGC command-authorization
version configured. The development backend must be independently enabled; the extension cannot
override backend scope, provider verification, Trust review, or publication checks. Offline/API
failures still remain in the bounded queue for retry. Returning to signed mode requires rebuilding
with `false`; store packaging requires both the process and local-file setting to be absent or
`false` and will not silently convert an active development configuration into a store archive.

Only in explicit development mode, `EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON` may be an
exact JSON array of up to three unique names from `greenhouse`, `lever`, and `ashby`. Absence
preserves `["greenhouse"]`; `[]` explicitly denies every provider. Unknown names, duplicates,
non-string entries, malformed JSON, and configuration outside development mode fail the build.
The selected array is copied and frozen at runtime. Both the process and `.env.local` provider
setting must be removed entirely before signed/store packaging, even if the array is empty.
This setting adds no provider host permission, remote policy request, or automatic activation:
keep Lever/Ashby disabled until their separate representative-fixture and server-registration
acceptance passes. Rebuild/reload after an accepted selection changes; existing Greenhouse
configuration needs no change.

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

The direct package build above always reads this workstation's public configuration. Root
`pnpm build` also rebuilds this extension instead of restoring or publishing a cached bundle:
its package-local Turbo build task disables caching because ignored `.env.local` settings affect
the output. Strict-mode builds pass only the ten explicitly listed public `EXTENSION_*` settings,
including the development-mode flag and provider selection; no client secret, access token, or signing private key is
allowed through that list. Other packages retain their existing cache settings. Rebuild and reload
the unpacked extension after changing its public configuration.

Load `frontend/extension/dist` as an unpacked extension. Register the generated extension ID's
exact callback/logout URL in the development Auth0 Native Application:

```text
https://EXTENSION_ID.chromiumapp.org/auth0
```

The access grant must include `jobs:read`, `jobs:write`, and the dedicated `jobs:contribute` scope
in addition to the existing profile scopes. A missing or malformed identity/API configuration
fails closed. Without an exact detector activation policy, provider capture remains disabled even
with valid identity configuration. The configured development build described above has its
separate accepted detector scope; repository defaults remain dark. The implemented
private saved-page API transport remains backward compatible but has no control in this extension
release candidate.

## Remaining activation gates

- Hosted Ashby server/source activation and the configured unpacked rebuild are complete; reload
  `dist` and inspect the observed `jobs.ashbyhq.com` posting, not the custom careers page. Validate
  the rendered preview and explicit delivery, then its Processing/Trust and website journey.
  Representative fixtures and bounded API acquisition do not establish installed rendered capture,
  delivery or publication. Existing reviewer powers are unchanged; this rollout authorizes no
  Ashby Trust decision. Global Lever's supplied job is user-confirmed published/accepted, with
  website detail/source acceptance still pending. Do not repeat its submission or decision.
  EU Lever and custom domains remain excluded; no store or production activation is implied.
- Broader live lifecycle acceptance remains separate from the user's 2026-09-11 confirmation of
  the reported Greenhouse job's published/accepted status and website search/detail/source display.
  That completed journey should not be requested again.
- Remaining installed Chrome/Edge Auth0 lifecycle, cancellation, rotation/replay, logout,
  revocation and cross-account/offline/restart conformance; initial installed Edge login passes.
- Accountable UGC, permission, privacy, security, accessibility, and store approval.
- Final archive, malicious-page, offline/replay, deployed rollback, alert, and kill-switch evidence.

Synthetic detector unit tests prove only local invariants. They are not provider evidence and do
not make the extension live-ready or store-ready.
