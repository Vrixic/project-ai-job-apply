# Browser Extension

This directory contains the Manifest V3 Chrome/Edge client for explicit current-tab job capture.
Its repository defaults remain a **synthetic, default-dark release candidate**. The configured
unpacked development candidate now enables the accepted Greenhouse, global-Lever and hosted-Ashby
variants on their four exact hosts; EU Lever and custom domains remain disabled. Development mode
avoids signed-policy renewal; the default distribution path remains signed-policy-bound.
The earlier September 12 description correction (D2-060) verifies at state `338`, Gateway/scheduled/Trust
`66`/`26`/`20`, from source `dccbb65`, preserving the state-336 provider activation. The configured
extension build passed typecheck, all 337 unit tests, 137 focused capture/readiness tests, four
runtime readiness cases and five generated-sanitizer checks. The user subsequently confirms
description availability but identifies its 12,000-character cutoff. D2-061 now implements complete
bounded descriptions and passes 368 extension tests and typecheck locally. Its compatible worker
release verifies from `edf0194` on September 13 at state `339`, Gateway/scheduled/Trust
`66`/`27`/`21`, with zero drift and unchanged provider/reviewer scope. The configured client is
rebuilt; eight full-description cases, current-source function parity and unchanged public
configuration checks pass. D2-061 is Complete for implementation/development release; installed
full-description acceptance remains under D2-035. Initial installed Edge sign-in and
server acknowledgement are confirmed for the existing journey. The supplied global-Lever job is
user-confirmed published/accepted; its website detail/source journey remains unconfirmed.
Acknowledgement is not publication: independent provider verification and Trust acceptance still
apply. Existing reviewer authority is unchanged. Production, general candidate release, and
browser-store distribution are not approved. See the current
[Phase 2 register](../../docs/product/delivery/phase-2-extension-and-community.md) for live gates.

## Implemented source boundary

Product scope: **Your shared jobs** and **Delivery queue** are development-only diagnostics,
not end-user features. D2-073 removes their HTML from nondevelopment side-panel
builds; only explicit development mode retains them. Packaging rejects diagnostic HTML in a
store archive. End-user add feedback reports the exact intent's delivery result, not queue totals.
Stop additional human-loop tests of those panels.
See the single [owner decision](../../docs/product/delivery/phase-2-extension-and-community.md#development-only-extension-diagnostics)
for rationale and acceptance; retain automated underlying security/reliability tests.

- Cached shared-job display reads only the current unexpired local session, without proactive
  OAuth refresh. A failed explicit history refresh retains same-owner cached receipts when that
  session is still valid. Expired/missing sessions and unreadable storage still hide history;
  network actions keep proactive refresh and existing authorization. No background history polling.

- Queue and shared-job section headers keep keyboard focus inside their clipped cards. From
  **Inspect current tab** with no preview, Tab reaches **Delivery queue**, then **Your shared jobs**.
  Press Enter or Space on a section header to expand it; Tab then reaches its enabled controls.
  Shift+Tab moves backward. The signed-out history refresh remains disabled, as intended.

- Failed sign-in resolves shared-job readiness from the current fenced session instead of treating
  browser-specific cancellation text as a history-storage error. Signed-out users see a sign-in
  requirement; actual storage failures remain unavailable. No history fetch or authentication
  bypass is added, and logout still supersedes late responses.

- Current-page inspection, readiness and enqueue resolve the most recently focused browser
  window (normal or browser popup), excluding detached DevTools, then its sole active tab.
  Saves still require the exact inspected tab ID/URL and session fence. Missing windows or tabs
  fail closed; there is no fallback to stored tabs, additional permission or private-save UI.

- D2-066 adds explicit **Refresh shared jobs** recovery of the latest 25 contributions from
  authenticated owner-only history. Logout still clears local receipts and pending items. A
  subsequent sign-in can reload acknowledged contributions without resubmitting them; requests
  and receipt commits remain account/session-fenced. The list distinguishes sign-in requirements,
  storage/API failure and successful empty results. Only identifiers, processing state and
  timestamps are returned; Trust remains a separate explicit refresh. The configured rebuild and
  full repository checks pass. Source1293's route/Gateway release verifies at state343 with
  Gateway67 and unchanged workers29/22. The user confirms existing history loads after pressing
  Refresh shared jobs in the reloaded extension; history does not automatically load after sign-in.
  D2-066 is Complete. The [Phase 2 register](../../docs/product/delivery/phase-2-extension-and-community.md#task-register)
  owns the separate remaining phase acceptance gates.

- D2-061 retains complete supported descriptions, including literal plaintext comparison symbols
  (`<`, `>`, `<=`, `>=`), up to 50,000 UTF-16 code units after whitespace normalization. Inspection
  checks the full text before repeated-heading removal; oversized text or structured description
  HTML above the existing 200,000-code-unit input bound is explicitly unavailable, never sliced
  into a prefix. The sanitizer independently checks the complete control-cleaned text. Tag-like
  starts (including incomplete/NFKC markup) remain unavailable. Expand/collapse affects only
  presentation, not the selected value. Fixed size explanations remain local and are excluded
  from contribution payloads. Existing queued approvals and both historical 12,000-character
  verifier aliases remain immutable; current full-description verification is deployed in the
  scoped development worker. See [D2-061](../../docs/product/delivery/phase-2-extension-and-community.md#d2-061--complete-description-capture).
- The complete serialized contribution also must fit the unchanged Gateway limit of 65,536 UTF-8
  bytes, including JSON escaping and metadata. The client checks the exact body before queue
  insertion or consent creation and again at transmission. Oversize refusal preserves the preview
  without silently truncating, dropping fields, or rewriting an existing queued intent. Per-field
  opt-outs are removed: Add sends all available captured public fields after preview. Jobs whose
  complete payload exceeds the wire limit cannot be added, even if within the character limit.
  No API shape, SQL, provider or runtime authority changes.

- A side-panel product shell (the toolbar icon opens it, docked to the right at the window's full
  height, and it stays open across tabs) with one explicit **Add job to shared database** action
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
  remote code. Opening the side panel or explicitly inspecting a page rechecks delivery readiness in a
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
  company, location, work type, description, and external job ID. Text is bounded and control-cleaned;
  descriptions reject markup without rewriting comparison symbols. URLs reject credentials,
  fragments, trackers, and local/private
  targets. A work arrangement embedded in a combined location such as `Remote-NORAM` is separated
  into grounded work type `Remote` and location `NORAM`.
- One field-level preview for the explicit public-add command. All available public fields are included;
  required source identity fields remain visible and cannot be silently removed. Pressing the add
  button is the user's instruction to enqueue all available captured public fields, without
  per-field checkboxes. Inspecting the page alone never enqueues a contribution.
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
  transport maps only the immutable command's allowed public fields, accepts only exact `no-store` server receipts, persists the
  server-issued receipt across ambiguous retries, and uses separate stable idempotency keys. The
  backward-compatible private-capture transport remains implemented but is not exposed by the
  public-add-only extension surface. Its authenticated POST now refuses redirects, matching the
  contribution/consent path; a refused redirect retains the pending intent and its stable retry key
  with a fixed, private-data-free failure. D2-064 is source-tested and rebuilt; installed rights
  preparation remains separate under D2-020.
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
- `sidePanel` — the extension's only surface: the toolbar icon opens it for the window, and it
  follows the active tab. Clicking the icon is also the `activeTab` grant for that page, so the
  panel is told when the candidate opens it on a page.

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
at least 15 seconds since the last check and press **Inspect current tab**, or open the side panel on another page.
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

The [Phase 2 remaining-input table](../../docs/product/delivery/phase-2-extension-and-community.md#remaining-acceptance-and-operator-inputs)
owns current acceptance. Earlier release checkpoints above are historical, not instructions to
repeat completed work.

- Supplied Greenhouse, global-Lever and hosted-Ashby publication, website description and source
  navigation are user-confirmed. Ashby's complete description is accepted. Do not repeat these
  submissions, decisions or checks. EU Lever/custom domains and production/store remain excluded.
- Chrome and Edge sign-in, cancellation, explicit session refresh, empty shared-history read and
  the corrected keyboard route are user-confirmed on September 15. Deeper rotation/replay,
  revocation, cross-account and queued offline/restart acceptance remains separate. Chrome and Edge
  empty-queue restart/reauthentication and D2-072 offline-history retention/online recovery are
  now owner-confirmed in both browsers;
  this is not acceptance of queued offline delivery, cross-account isolation or token replay.
- Fresh nonempty disposable export/deletion is complete under D2-020, including the private-capture
  compatibility API. Do not recreate or reuse the deleted test account.
- Nonempty takedown/human appeal and final alarm-recipient acceptance remain. D2-028's bounded
  authenticated workload, exact-window cloud corroboration and cleanup pass; do not rerun it.
  Existing reviewer separation and exact provider scope are unchanged.
- Monitored support contact, exact store candidate/screenshots and accountable release/store
  approval remain. The owner deferred manual screen-reader testing on September 15; retain
  keyboard/reflow/semantic protections and automated accessibility coverage without claiming that
  unperformed test passed or waiving independent store requirements.

Synthetic detector unit tests prove only local invariants. They are not provider evidence and do
not make the extension live-ready or store-ready.

## Manual approved application handoff (D3, default off)

The same unpacked-only configuration exposes explicit “Copy employer question structure”. Paste
an exact application review link on its current canonical employer page. Protected owner/job
reads bracket bounded top-frame extraction; tab/account/revision changes refuse the result.
Only question metadata is copied, never entered answers, uploads or tokens. Challenges/oversized
structures are refused. Paste into the web saved-answer selection surface within 60 seconds;
clipboard content remains candidate controlled. No form is filled or submitted, and no snapshot
queue is persisted. See [ADR-046](../../docs/adr/046-observed-form-saved-answer-selection.md).

For controlled unpacked testing only, set `EXTENSION_APPLICATION_HANDOFF_ENABLED=true` and one
exact HTTPS `EXTENSION_APPLICATION_HANDOFF_WEB_ORIGIN`. Identity and API configuration are required;
the extension's public-client grant needs `applications:read`. No grant is created by the build.
Store packaging rejects this feature even if another configuration source overrides it to false.
Only enabled handoff builds request `clipboardWrite` so copying works after slow authorization
rechecks. No clipboard-read or employer-host permission is added; default-off permissions stay unchanged.
The web workspace independently needs `NEXT_PUBLIC_APPLICATION_EXTENSION_HANDOFF=enabled`.

Copy the approved application's review link from the web workspace. Open the matching employer
page and paste the link into “Application review handoff.” Each answer copy rechecks the
current account, tab, job, packet, approval and original material expiry/withdrawal. Restricted
answers require question/context confirmation on every copy. Documents stay in the native web
workspace; the extension performs no fill or submission. Return to the linked application to
record and confirm manual submission. Previews expire within 60 seconds and clear on identity
change, exit or explicit clear. Clipboard copies remain under the candidate's control.

`node scripts/tests/d3-browser-assurance/handoff.mjs` from the repository root exercises production
handoff UI/background and generated static validators under MV3 script CSP with a real Chromium
clipboard. Auth, Chrome APIs and API responses are synthetic. Installed Chrome/Edge, live identity,
provider fixtures and release acceptance remain unverified. See [ADR-045](../../docs/adr/045-manual-approved-application-handoff.md).

## Approved native file transfer (D3, separate default-off build)

An unpacked execution build additionally requires `EXTENSION_APPLICATION_EXECUTION_ENABLED=true`
and the exact handoff origin above. Only that build exposes website messaging and requests the
existing `applications:write` scope; the actual public-client delegated grant still needs live
verification. It grants no employer host access and store packaging rejects execution. Manual
handoff builds retain their read-only application scope and no external listener.

Filling and submitting are off in that build until it names a provider (ADR-053):
`EXTENSION_APPLICATION_EXECUTION_PROVIDERS_JSON='["greenhouse","ashby"]'` (any unique subset; Lever
and the generic adapter cannot be named). The build then enables exactly those adapters, records the
owner's live-effects approval, and binds evidence to the adapter version and a hash of the provider
source it contains. That evidence expires 90 days after the build, after which the extension stops
acting and the candidate uses the manual path until it is rebuilt. Without the variable every kill
switch stays off. The candidate still approves each application on the website and confirms in the
extension on the employer tab; the click happens once.

The web native workspace separately requires `NEXT_PUBLIC_APPLICATION_EXTENSION_TRANSFER_ENABLED=true`
and `NEXT_PUBLIC_APPLICATION_EXTENSION_ID` set to one exact installed Chrome extension ID. Pressing
**Apply** in the website opens the employer page and sends an identifiers-only apply intent
(`application-apply-intent.v1`); the side panel then offers that application and the candidate confirms
on the employer tab (no manifest or permission change). The generated resume is PDF only and is
pushed by the website; when none is valid the extension pulls the candidate's uploaded resume
(original format, at most 2 MiB) with its own session. An expired or mismatched file is never
attached. See [ADR-050](../../docs/adr/050-generate-then-apply-flow.md). Native credentials remain
in the web session. One private extension
selection/admission binds both documents, account, job, packet, approval and original generation.
There is no file storage, discovery, upload or submission in this batch. Withdrawal, identity change,
navigation, restart and original expiry discard the memory inventory; unknown acknowledgements
never authorize a provider retry. Production registry controls remain dark pending accepted provider
fixtures and accountable live-effect approval. See [ADR-049](../../docs/adr/049-greenhouse-approved-application-execution.md).
