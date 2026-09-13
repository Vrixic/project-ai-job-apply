# Phase 2 Extension and UGC Security/Privacy Delta

- Status: Engineering design; accountable approval pending
- Last updated: 2026-09-13
- Decision boundary: [ADR-028](../adr/028-extension-ugc-ownership-and-processing.md) and
  [ADR-029](../adr/029-one-step-public-job-addition.md)

This is the single D2 engineering delta for the extension, contribution, and community trust
surface, not a deployment authorization. The separately recorded controlled Greenhouse,
global-Lever and hosted-Ashby development activation and narrowly scoped reviewer assignments remain in the
[Phase 2 record](../product/delivery/phase-2-extension-and-community.md). This document grants no
additional provider, reviewer, production, or browser-store authority; human appeals remain
separate.

## Minimum data flow

```text
explicit current-tab action
  → local provider detector and strict field sanitizer
  → candidate preview and field removal
  → explicit Add job to shared database command
  → extension background session + bounded pending queue
  → authenticated gateway (`jobs:contribute`)
  → Jobs atomic queued intake + identifier-only outbox
  → source-safe normalization and independent verification
  → Trust review when required
  → accepted catalog observation or rejected/removed state
```

The normal path stores no raw DOM or page snapshot. Allowed contribution values are the canonical
source URL and selected structured public fields needed to identify and verify the posting. URLs
must use HTTPS, remove credentials/fragments/tracking parameters, reject local/private/link-local
targets, and match an enabled supported provider/domain rule. Text must be bounded, normalized,
free of markup/control characters, and never interpreted as instructions.

D2-060 distinguishes literal plaintext comparison symbols from markup in descriptions only.
Client extraction remains inert; Jobs rejects tag-like starts, incomplete markup and NFKC forms,
while text-node/escaped rendering preserves comparison operators. Existing other-field guards,
authorization, payload digests and complete independent provider truth are unchanged. Both frozen
legacy and comparator-preserving 12,000-character representations remain frozen. D2-061 adds
complete current descriptions within the existing 50,000-character bound (JavaScript UTF-16 code
units), after whitespace normalization and before repeated-heading removal. Oversized descriptions
or structured HTML above the existing 200,000-code-unit client input bound are explicitly omitted,
not truncated; fixed local explanations never enter the submitted fields. Sanitization independently
checks the complete value. Full compatibility digests derive only from complete independent
evidence, not the historical sliced acquisition. A maximum of twelve response-bound digests covers
two heading/layout choices, two existing provider presentations, and three historical/current
representations. Old aliases are retained, while changed tails/numbers, arbitrary prefixes and
unbounded collections reject. No candidate-supplied aliases or canonical provider-truth changes.
Ashby's HTML may also corroborate its full native plaintext representation: exact href/image
annotations, list dashes and uppercase heading text, compared case-sensitively after whitespace
collapse. Attributes remain exact and are never fetched; the bounded conversion neither changes
canonical provider plaintext nor applies to other providers.

The complete contribution's JSON encoding must also fit the unchanged 65,536-byte UTF-8 Gateway
body limit, including metadata and escaping. Client preflight refuses an oversized request before
queue insertion or consent creation, with a final serialization check before transmission. Field
selection remains editable so the user can deselect optional content and explicitly retry; no field
is silently shortened or removed, and existing queued approvals remain unchanged. The character
bound does not guarantee wire-byte fit. D2-061 passes 368 client and 574 ingestion tests locally;
its compatible development worker release and configured-client rebuild are verified. Installed
full-description acceptance remains under D2-035. The browser-free
`pnpm test:d2-contribution-intake` regression now runs in `pnpm check` and the maintained verifier.
No API/event shape, SQL, provider activation, reviewer permission or runtime authority changes.
The existing [Phase 2 decisions section](../product/delivery/phase-2-extension-and-community.md#decisions-and-scope-changes)
owns the decision rationale; this is engineering behavior, not new release approval.

## Data classification and ownership

| Data | Classification | Owner | Required behavior |
|---|---|---|---|
| Selected job fields and canonical public URL | Public before submission; Internal while pending | Jobs | Strict allowlist, digest binding, source-safe verification |
| Contributor association and contribution status | Confidential | Jobs for owner-scoped command/status | Never public or placed in events/telemetry |
| Command-authorization record and policy version (v1 API name: contribution consent) | Confidential | Profile | Immutable, exact payload digest, revocable before publication; not presented as permission to read a public page |
| Reputation, sanctions, takedown, withdrawal, appeal | Confidential/Internal | Trust | Private, appealable, human-controlled where policy requires |
| Pending extension intent | Confidential local device data | Extension client | Minimum fields, bounded retention, account fencing, clear on acknowledgement/withdrawal |
| Authorized provider fixture raw capture | Restricted evidence outside Git | QA/security evidence owner | Encrypted quarantine, access audit, maximum 30 days, disposition evidence |

## Threats and required controls

- **Over-permission or browsing surveillance:** no `history`, `cookies`, broad `webRequest`, or
  `<all_urls>` permission; use explicit `activeTab` or narrow optional hosts and disclose each use.
- **Token theft:** public-client PKCE, short-lived access tokens, rotating refresh tokens confined to
  trusted extension session storage, exact sender validation, logout/revocation, and no token logs.
- **Malicious page/UGC:** strict structured extraction, local and server validation, no executable
  page content, bounded values, safe URL policy, output encoding, verification, moderation, and
  rate/abuse controls.
- **Provider truth corruption:** separate append-only UGC evidence, explicit precedence, no
  activation/freshness refresh before independent verification, and conflicts routed to review.
- **Cross-user replay:** owner-scoped semantic UUID plus request digest and idempotency key; status,
  withdrawal, and appeal enforce the authenticated owner.
- **Offline duplication or account mix-up:** durable local state machine, stable keys, bounded
  retry, timeout-after-commit replay, and a versioned one-way account fence derived from the exact
  Auth0 issuer, API audience, Native Application, and token subject. The same account reproduces
  the fence after full reauthentication; a different account or mismatched refresh remains blocked.
  Raw token subjects are never stored, and explicit logout clears local queue/session state.
- **Ambiguous destination or duplicate approval:** one labelled public-add command after the exact
  field preview; no private-save control or second approval checkbox in this extension candidate.
- **Contributor exposure:** contributor identity and reputation absent from catalog responses,
  events, logs, analytics, public moderation summaries, and other contributors' views.
- **Pre-verification owner cancellation:** an owner-locked permanent Jobs state marker blocks
  verification/publication before Profile revocation completes. A Profile outage returns an
  incomplete response but cannot revive eligibility; replay completes the exact revocation. The
  existing Trust withdrawal path remains required once verification or later evidence exists.
- **Stale terminal reconciliation:** completed processing work can be reawakened only by a new
  actionable authoritative Trust decision. A consumed-decision marker fences repeated/old signals;
  provider nudges cannot reopen terminal work, and exhausted work remains terminal.
- **Reviewer evidence exposure:** reader-role-protected bounded case pages and version-bound
  plaintext provider evidence omit contributor identifiers and raw HTML. The exact verification
  digest can support initial review, while takedown and appeal evidence remain separately approved.
  Reading evidence does not grant decision authority or bypass the distinct appeal reviewer.
- **Remote-code/update abuse:** no remote executable code; versioned signed package/config data,
  reproducible bundle inspection, minimum CSP, and version/domain kill switches.
- **Store/disclosure mismatch:** generated manifest permissions must match the reviewed disclosure,
  privacy statement, screenshots/copy, network behavior, and final archive.

## Development contribution configuration

Development contributions can use an explicit persistent server setting and an unpacked-only
extension setting instead of the signed capability envelope. The server rejects the setting
outside development; extension-store packaging rejects the configured mode and marked artifacts.
This path uses no signing keys, remote policy fetch, or deployment-expiry check. Development
defaults to Greenhouse alone. Source configuration can independently select the fixed Greenhouse,
Lever, and Ashby descriptors; explicit empty selection denies all, invalid input fails closed,
and provider selection outside explicit development is rejected. Exact client, provider variant,
HTTPS hosts, runtime enable flags, authentication, preview-bound command authorization,
independent provider evidence, Trust decisions, and account fencing remain enforced. Detector
activation and exact provider registrations are separate. The approved Phase 2 state-336 rollout
preserves Greenhouse and Supermove/global-Lever registrations and adds only the supplied hosted
Ashby board. D2-060's compatible description code subsequently verifies from `dccbb65` at state
`338`, Gateway/scheduled/Trust `66`/`26`/`20`, with zero meaningful Terraform changes and unchanged
authority/configuration. D2-061's full-description worker release subsequently verifies from
`edf0194` at state `339`, Gateway/scheduled/Trust `66`/`27`/`21`, with zero drift and unchanged
authority/configuration. The matching configured client passes eight full-description cases,
current-source function parity and unchanged public-configuration checks. Three exact
sources/verification registrations serve the four allowed hosts:
the two existing Greenhouse hosts, `jobs.lever.co` and `jobs.ashbyhq.com`. EU Lever, custom-domain
detection, general provider ingestion, production and store distribution remain disabled.
Those deployments changed no reviewer authority. The separately recorded September 13 approval
adds initial review of the supplied Ashby contribution only; fresh independent evidence supports
one decision with an independent `accepted` / version `2` readback. Existing Greenhouse
initial/takedown, approved global-Lever initial review, exact roles/scopes and independent human
appeals remain unchanged. No other Ashby review, Ashby takedown, production or store authority is
included. Scope and rationale remain in the [single Phase 2 record](../product/delivery/phase-2-extension-and-community.md#delegated-reviewer-assignment).
Accepted fixtures, development activation and this decision do not establish publication;
processing publication and website acceptance remain under [D2-035](../product/delivery/phase-2-extension-and-community.md#d2-035--ashby-development-rollout).
The optional `D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON` further intersects descriptor authority
with an exact fixed-host subset, re-read at intake and before publication preparation/renewal.
It is rejected outside explicit development; absence preserves descriptor hosts, while `[]`
denies all. Global-only Lever activation must explicitly retain the domain restriction because
the immutable Lever descriptor itself includes both regional hosts. Release domain-aware code
before introducing the provider/domain configuration together. Existing in-flight 60-second
publication leases may finish; no instantaneous old-version revocation is claimed.
Consent and contribution HTTP requests refuse redirects, including cross-origin redirects.

Prepared development publication operations use a 60-second automatically refreshed lease after
fresh authority/evidence checks. Jobs migration `0021` permits only that narrowly scoped update;
forward migration `0022` retains the original Greenhouse descriptor and enumerates two additional
exact provider version/digest pairs. Stored provider/variant/client and source host must match
the descriptor; another provider's lease cannot substitute. Created time, identity, evidence,
and signed/terminal rows remain immutable. Deploy the forward migration before enabling new
providers. Existing signed-mode binaries remain compatible with the schema;
rollback disables development contributions before reverting code. This is a technical boundary
description; the single decision and rationale are in the
[Phase 2 record](../product/delivery/phase-2-extension-and-community.md#decisions-and-scope-changes).

## Fresh verification and accepted evidence

D2-059's Ashby-specific large-board verifier was implemented and locally verified at `09cc3fa`
on September 12, before the separately approved development rollout. It reuses the registered independent
verifier and exact-poll seam, streams only the documented public full-board GET with compensation
excluded, and returns the exact selected posting through the existing Jobs/Trust gates. The
separate frozen `ashby-exact-board-v1` profile bounds decompressed bytes, scanned records,
serialized-record/envelope, depth, key and fragment buffers plus whole fetch/body/parse time.
Only one selected record is retained. These are structural bounds, not a measured total V8 heap
or RSS ceiling; exact limits and evidence are recorded in the [existing Phase 2 task](../product/delivery/phase-2-extension-and-community.md#d2-059--bounded-ashby-exact-board-verification).
Validate full EOF including trailing content, identities and duplicates before evidence; failure,
partial acquisition or absence cannot establish acceptance or closure. Retain only target data
beyond bounded transient parsing, with no raw-body persistence or telemetry. Only Ashby's
source-configuration digest binds all eight frozen profile fields; general scheduled polling
retains `1_000_000` bytes/`100` jobs/`5_000` ms and Greenhouse/Lever digests stay unchanged.
Independent review, focused regressions and the full maintained verifier pass. A subsequent
bounded read-only preflight validates the complete 2,118,913-byte/71-record public board and the
exact supplied posting; only the selected in-memory record is replayed through strict mapping.
No raw response was persisted and no catalog/deployment/activation change occurred during that
earlier preflight. Its success is not installed contribution or publication acceptance.
The subsequent [development rollout](../product/delivery/phase-2-extension-and-community.md#d2-035--ashby-development-rollout)
binds the exact Ashby configuration, publishes compatible immutable binaries and verifies the
four-resource configuration-only activation at state `336`. D2-R22 closes for acquisition,
source binding and deployment; D2-035 remains open for installed acceptance. No API/event/SQL/
migration or candidate/reviewer authority changed. EU/custom-domain, production/store and general
provider-ingestion activation remain excluded.

The coordinated September 10 D2-039 rollout applied Jobs `0023` and Trust `0004`; the
[Phase 2 register](../product/delivery/phase-2-extension-and-community.md) owns exact release and
subsequent recovery evidence. Initial acceptance and appeal
reversal require exact, independently fetched provider evidence no more than 24 hours old and
not future-dated. Trust records the accepted provider basis separately from review/appeal
evidence; a distinct appeal digest never becomes provider truth. Historical Trust rows retain
unknown basis as null. Existing single-proof Jobs acceptance is explicitly bound before the
singleton constraints are removed; only an exact already-copied legacy signal can be acknowledged
without constructing a new binding.

The existing scheduler can refresh stale, unpublished initial-review proof at most three times
per contribution, with at least one hour between attempts. Proof generations remain append-only;
the original submitted fields, review case, and one-time events are unchanged. The worker checks
the authoritative initial-review state before and after the fetch, and the reservation binds the
specific queue lease. Appeals, terminal cases, cancellation, and an exhausted refresh budget do
not gain automatic approval or reset. Expired accepted-but-unpublished proof remains held; it is
not silently rebound or re-decided.

Publication checks the exact latest accepted provider basis again. Older observations cannot
overwrite newer source, lifecycle, or canonical truth. Exact timestamp ties are idempotent when
their persisted fields match; contradictory ties are held. Candidate export includes the separate
case/event basis without reviewer identities, tokens, or transport details. Events remain
identifier-only.

That rollout quiesced contribution processing and reviewer decisions before applying the two
migrations, then deployed the coordinated Gateway and workers before resuming. The old singleton
verification writer is not compatible with Jobs `0023`; rollback must keep contributions disabled
or use a forward-compatible binary. Keep historical receipts and restore manifests distinct from
the new 44-migration source boundary. Decision rationale is recorded only in the
[Phase 2 decisions section](../product/delivery/phase-2-extension-and-community.md#decisions-and-scope-changes).

## Local human reviewer setup boundary

The optional local appeal setup check is default-dark, finite-window, exact-localhost and
same-origin only. It compares the server-held SDK session and independently verified signed API
token with an independently supplied issuer/subject/client/audience configuration. Fresh MFA and
only the approved appeal/read scopes are required. The client supplies no identity or token;
the only outbound request retrieves the exact issuer's public JWKS with redirect, time, and body
bounds. No Management API, Gateway, refresh-token, role, or case operation is performed.

Expected identity/configuration remains process-only. An exclusive-create result in the private,
Git-ignored setup directory contains verification aggregates and a one-way identity-binding
fingerprint, not raw identifiers or tokens. Treat the fingerprint as pseudonymous confidential
setup data rather than anonymous telemetry; do not publish it in docs, logs, or browser output.
The local launcher verifies current-user-only access and preserves existing encrypted setup.
The server rejects expired windows, unexpected paths, filesystem links, and overwrites. This
check is not enabled on Vercel and cannot itself grant reviewer permissions. The assignment and
decision rationale remain in the [Phase 2 record](../product/delivery/phase-2-extension-and-community.md#delegated-reviewer-assignment).

## Retention and deletion

- Normal contributions retain zero raw page snapshots.
- Pending device intents are removed after acknowledged terminal handling or after 24 hours. The
  product owner selected this minimum practical offline-retry window for the Phase 2 candidate on
  2026-09-03; accountable security/privacy acceptance remains required before real use.
- Sanitized contribution records follow the approved lifecycle; removed/expired records retain only
  a minimal non-PII integrity/deduplication tombstone.
- Contributor associations participate in authenticated export/deletion and contribution
  withdrawal. Restores must replay deletion/withdrawal ledgers before serving.
- The 30-day raw-contribution quarantine value applies only to separately approved external fixture
  evidence. It is a maximum, not a normal product retention target or public promise.

## Release gates

These acceptance areas cannot be self-certified by repository implementation; the Phase 2
register distinguishes completed evidence from remaining gates:

1. LR-D2-01 contribution license, provenance, contributor privacy, takedown, withdrawal, appeal,
   and repeat-abuse disposition.
2. LR-D2-02 extension permissions, browsing-data disclosure, privacy statement, and store-policy
   disposition.
3. Accountable D2 security/privacy acceptance of the exact data flow, controls, retention,
   subprocessors, telemetry, and deployed candidate.
4. Authorized Greenhouse, Lever, and Ashby fixtures with capture authorization, scans,
   sanitization and QA representativeness acceptance, and raw disposition. D2-011 completed the
   initial scoped variants on September 11; EU/custom-domain and rendered-hydration coverage
   are not implied and fixture approval is not a recurring blocker for the accepted variants.
5. Dedicated extension Auth0 Native Application plus Chrome and Edge PKCE, refresh rotation/replay,
   cancellation, logout, and revocation evidence.
6. Final archive permission/CSP/remote-code/secret inspection, accessibility and malicious-UGC
   browser tests, default-dark deployment, rollback, restore, load/abuse, alerts, and kill-switch
   evidence.

Until all applicable gates pass, production and store distribution remain dark. The separately
authorized development exception covers the recorded Greenhouse, global-Lever and hosted-Ashby
scope only; contribution intake is not publication approval. EU Lever, custom-domain and broader
use remain excluded; installed Ashby acceptance is still open. The Phase 2 record distinguishes
the user's latest Lever Processing
`published` / Trust `accepted` report from its still-unconfirmed website visibility/details/source
journey; that report grants no additional authority.
