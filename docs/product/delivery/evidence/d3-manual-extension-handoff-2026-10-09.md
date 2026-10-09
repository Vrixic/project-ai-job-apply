# D3-086: Manual approved-application extension handoff

Date: 2026-10-09. Default-off source; D3 remains In progress. Independent D1 acceptance,
including hosted admin acceptance, remains deferred. No provider or cloud capability was activated.

## Implemented scope

Approved web application -> opaque first-party application/job link -> trusted extension UI on the
matching employer page -> existing owner-scoped packet/job/scalar material proofs -> explicit
answer copy -> exact web application -> existing manual submission/outcome/history flow.
No automated fill, upload, provider request or submission is added. Generated content stays in the
native browser workspace. Saved-answer **selection** and provider adapter source remain unfinished.

Every preview/copy checks owner, exact job revision/destination, packet revision/hash, approval,
original material expiry/withdrawal, current saved-answer references and active/ambiguous attempts.
Preview memory lasts at most 60 seconds and never renews original deadlines. Restricted answers
show their saved context and require fresh question/context confirmation on each copy. Preserve
`false` as “No”; exclude documents, generated values, attestations, signatures and challenges.
Identity change, clear, exit, expiry or clipboard refusal discards the preview and fences late work.
No private answer queue is persisted. Clipboard copies remain candidate controlled.

Both clients default off. Enabled unpacked builds alone request write-only `clipboardWrite` for
asynchronous owner rechecks; default-off permissions are unchanged. No employer-host or clipboard
read grant is added. Store packaging rejects enabled handoff from either configuration source.
Existing v1 schemas/routes are unchanged; generated static validators support MV3 script CSP.
The shared job digest input preserves existing packet hashes. See [ADR-045](../../../adr/045-manual-approved-application-handoff.md).

## Executed checks

- 43 core handoff regressions cover owner/job/proof refusal, expiry, withdrawal, changed packet/tab/
  identity, pending-read cancellation, restricted context/confirmation/reset, inert rendering,
  late-copy suppression, boolean preservation and clipboard failure. Build/accessibility and
  public-client scope regressions pass; default-off and store boundaries remain explicit.
- Web checks cover opaque link gating, exact application lookup, wrong ID/job/404 refusal and retry,
  plus direct application reopening independent of current catalog availability. Three gateway
  parity tests preserve canonical hashes; static validators match the server's strict schemas.
- `node scripts/tests/d3-browser-assurance/handoff.mjs` passes with production handoff UI/background,
  actual HTTP reader/static validators under MV3 script CSP and real Chromium clipboard. Chrome
  APIs, identity and responses are synthetic; per-copy reads and changed-tab refusal are exercised.
- `node scripts/tests/d3-browser-assurance/run.mjs` passes search -> Prepare -> review -> approve ->
  manual Apply -> candidate-confirmed submission/history, native resume/cover-letter review, four
  approved downloads, expiry, keyboard and axe checks. Identity/BFF/native responses are synthetic.
- All three generated artifacts are byte-identical on regeneration. Formatting and diff checks pass.
- Full `scripts/verify-phase0.ps1` passes: generation, operator guards, formatting, lint,
  type checking, dependency security, builds, repository tests, bundle isolation and Compose
  configuration. Relevant totals: 108 contract, 855 web, 526 extension and 379 gateway tests pass.
  The gateway's 116 opt-in integration skips are not managed-database acceptance. No persistence
  or migration change is made in this batch. All 148 local Markdown link targets resolve.

The full verifier initially found a new contract-test declaration import and two stale test
assumptions (generated variable declaration shape and live-region count); these were fixed and
their affected checks pass. No contract validation or permission gate was weakened.

An additional actual unpacked Chromium probe reached real popup/service-worker owner reads and
observed clipboard refusal after native focus loss. One immediate write succeeded before the
probe's read-permission assertion failed, but this is not reproducible acceptance. The complete
probe did not pass; its prototype/log are retained only under ignored `.tmp`. Controlled focused
popup copying, slow focused copying, installed Chrome/Edge identity and live endpoints remain open.
Do not equate the reproducible CSP harness's simulated Chrome APIs with installed acceptance.

## Shutdown and external gates

AWS access remains sequential. Fresh staging lifecycle status at 20:10 UTC verifies dormant, zero database,
interface endpoints, public routes, enabled mappings/rules and queue depth. Additional staging
readback at 19:35–19:39 UTC confirms zero EC2/ECS tasks/services, NAT gateways, interface endpoints,
EIPs/EBS, enabled Scheduler schedules, provisioned concurrency and running durable executions;
all three queues are empty. Six functions/one durable definition remain deployed dark.
Development's earlier 18:40 UTC dormant readback remains historical; fresh development access
requires sign-in after switching. No runtime was started by this batch. Retained recovery/storage/
security resources can still incur charges. At 20:10 UTC, `wsl --shutdown` completed, no running
WSL distributions were listed and no Docker processes were present. The PC remains on.

Live same-owner Auth0/native DNS/TLS/CORS/provider-retention/release and all-copy expiry acceptance,
authorized provider application fixtures, independent QA and accountable reviews remain open.
This batch does not close these gates or the overall D3 exit criteria.
