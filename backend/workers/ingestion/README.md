# Source-neutral ingestion worker

Owns the provider-independent worker contract that turns an explicitly enabled source adapter's
bounded, normalized public-job batch into Jobs-owned catalog observations.

The durable runtime is source-neutral and supports explicitly configured Greenhouse Job Board,
Lever Postings, and Ashby Job Board sources. Repository and environment defaults configure none of
them and keep provider activation disabled. The registry rejects an enabled provider unless the
runtime supplies explicit provider-activation authority; every source also has its own `enabled`
flag and exact Jobs-owned `sourceId + adapterVersion + adapterConfigSha256` pause gate. No real
board/site identifier, company configuration, schedule, queue mapping, egress, or provider data is
configured by default. Public UGC intake remains Jobs-owned; D2 reuses this worker's independent
provider verifier without treating candidate-supplied content as catalog truth.

## Implemented boundaries

- `page-preview-compatibility.ts` — D2-061 retains both frozen 12,000-character v1 representations
  and adds complete descriptions up to 50,000 UTF-16 code units, derived only from independently
  fetched provider evidence. Full HTML-preview text is whitespace-normalized and size-checked
  before repeated-heading removal; an oversized value never gains a 50,000-character prefix
  alias. Up to twelve response-bound digests cover two heading/layout choices, two existing
  provider presentations, and the three historical/current representations without dropping old
  approvals. Actual Greenhouse currency and Lever join combinations exercise that bound; thirteen
  digests refuse. Full provider text remains canonical, while changed tails, comparison operators,
  numbers and arbitrary prefixes mismatch. Markup/NFKC/control guards and reader version
  `d2-job-page-v1` are preserved. No candidate-supplied aliases, new provider request scope or
  acquisition-limit increase. All 574 ingestion tests and typecheck pass locally; the compatible
  worker deployment remains pending under [D2-061](../../../docs/product/delivery/phase-2-extension-and-community.md#d2-061--complete-description-capture).

- `contract.ts` — strict adapter, registry, catalog-port, and aggregate-result shapes.
- `registry.ts` — immutable registration, duplicate rejection, and default-deny activation.
- `backoff.ts` — bounded deterministic retry delay calculation without source values.
- `orchestration.ts` — a provider-neutral protocol kernel for immutable schedule occurrences,
  revision- and lease-fenced attempt transitions, deterministic bounded retry jitter, kill-switch
  pause, and aggregate-only queue dispositions.
- `runner.ts` — allowlisted observation mapping, Jobs-domain validation, batch collision checks,
  idempotent catalog-port calls, and aggregate-only results.
- `contribution-verification.ts` — a default-dark independent-provider verification port. It polls
  only an explicitly enabled registry source bound to an exact provider, page variant, tenant, and
  source-policy version; reuses the reviewed ingestion boundary; returns bounded independent
  provider evidence for Jobs-owned staging; resolves existing job/source IDs through an injected
  read-only exact catalog lookup; and never writes catalog observations or advances freshness.
  Ambiguous identity parks; a genuinely new exact provider identity may be staged without catalog
  IDs and published only through the separate gated reconciler. Optional field omission and exact
  grounded location/work-type splits compare equivalently while original provider truth is retained.
  Optional posting-ID omission does not prevent verification: the required canonical provider URL
  supplies only the internal exact-fetch identity, while any explicitly conflicting identifier
  rejects before polling. Submitted payloads, normalizations, and their digests remain immutable.
  Legacy singleton location previews may select one exact provider-original location or explicit
  structured-address display; they do not replace the full independent location set.
  The adapters also supply bounded, response-object-bound v1 preview digests derived from inert
  API HTML text nodes. These account for exact DOM block concatenation without changing words,
  amounts, or full provider catalog text. Lever/Ashby auxiliary HTML must corroborate the entire
  corresponding provider plaintext. Only Greenhouse retains its reviewed dollar-range separator
  representation; other providers do not inherit that transformation.
  Digests exist only in a weakly held in-memory association: no raw HTML or extra source field is
  persisted, published, or returned to clients, and other reader versions do not inherit it.
- `synthetic.ts` — deterministic generated `.example.test` observations representing no provider,
  employer, tenant, or real job.
- `greenhouse.ts` — fixed-host public Job Board GET adapter with redirect refusal, bounded timeout
  and streaming response bytes, strict response mapping, plain-text conversion, tracking-query
  removal, and reviewed company/domain inputs. Exact-job responses use their own validated company
  field when present, with the configured label only as an absent-field fallback. Bounded outer
  entity decoding and inert HTML parsing handle description markup without executing/fetching
  embedded content or retaining scripts, forms, templates, styles, or raw pages. Independent contribution verification uses the
  exact public job endpoint so a large board cannot force weakening the one-megabyte response cap;
  scheduled ingestion retains the bounded board endpoint. It is tested with generated responses
  and remains impossible to enable through the default registry policy without explicit runtime
  authority.
- `lever.ts` — fixed global/EU Postings GET adapter with paired API/hosted-job hosts, bounded
  pagination and overflow refusal, tracking-query removal, and exact site/posting identity.
  Contribution verification uses the documented exact-posting endpoint with unchanged timeout,
  redirect refusal, and one-megabyte cap. The complete description retains the opening/body once,
  bounded inert list headings/content, optional salary-description text, and closing text. No
  application request or authenticated API is used; missing/failed exact responses never infer closure.
- `ashby.ts` — fixed public Job Board GET adapter with exact API version, listed-only projection,
  bounded locations and response size, documented work-mode/employment mapping, and exact
  board/posting identity. It requests no compensation data and never calls an authenticated API.
  Public API documentation provides only board acquisition; general polling response/count caps
  remain unchanged. An unlisted record causes catalog withdrawal, not a claim of employer closure.
  D2-059's Ashby-specific `pollExact` is implemented and locally verified at `09cc3fa`:
  stream the same documented full-board GET with `includeCompensation=false`, retain the exact
  target and validate full EOF before returning it through the existing independent verifier.
  A separate frozen `ashby-exact-board-v1` acquisition profile bounds response, record scan,
  serialized-record/envelope/depth/key/fragment buffers and whole-operation time, retaining one
  selected record. This is not a measured total V8 heap/RSS ceiling. Only Ashby's source digest
  changes, binding all eight profile fields; the later development rollout supplies that fresh binding.
  General scheduled polling retains `1_000_000` bytes/`100` jobs/`5_000` ms; Greenhouse/Lever digests
  stay unchanged. Identity,
  duplicate, malformed, overflow and deadline failures deny without partial evidence or
  absence-based closure; raw bodies are never persisted. Reader 131/131, the full ingestion suite
  427/427 and the maintained repository verifier pass. A subsequent read-only live preflight
  validates the complete 2,118,913-byte/71-record board and supplied exact posting, then replays
  only that in-memory record through the strict mapper. No raw response is persisted and no
  catalog, deployment or activation changed during that earlier preflight. The separately approved
  source binding and development rollout subsequently verify at state `336`; installed Ashby
  acceptance remains open. See the [verified task and exact bounds](../../../docs/product/delivery/phase-2-extension-and-community.md#d2-059--bounded-ashby-exact-board-verification)
  and [development rollout](../../../docs/product/delivery/phase-2-extension-and-community.md#d2-035--ashby-development-rollout).
- `provider-description.ts` — bounded inert HTML-to-plaintext/textContent conversion for independent
  Lever/Ashby evidence, excluding executable, form, and embedded-resource subtrees. It retains no
  raw HTML and never executes or fetches page content.
- Its Ashby-only `parseCorroboratedAshbyDescriptionHtml` first accepts direct complete plaintext
  equality, then one exact native representation with href/image references, list dashes and
  uppercase heading text. It compares the entire result after whitespace collapse; URL attribute
  case/spelling is unchanged. Input/traversal/native-output bounds remain 100,000. Only then may
  existing page textContent aliases be used; the complete canonical `descriptionPlain` is unchanged.
- `orchestration-store.ts` — the storage-neutral coordinator that commits every schedule, claim,
  settlement, pause, and retry through the Jobs-owned compare-and-swap port before returning a
  transport disposition.

An empty batch or source acquisition failure never proves that a stored job is closed. Unexpected
adapter failures become a redacted retry result and do not call the catalog. Catalog contract or
identity failures propagate so durable orchestration can stop and alert instead of retrying an
invalid payload forever.

The orchestration kernel is a pure, storage-neutral transition boundary. Its execution identity is
derived from the exact source, adapter version, and canonical UTC schedule slot. Claims require a
bounded lowercase UUIDv7 lease plus the exact checkpoint revision; stale or competing claims and
settlements fail closed. An expired claim can be replaced on the same attempt through a higher
revision, fencing any late settlement from the crashed worker. Because the expired worker may have
partially written before crashing, every replacement claim carries unknown prior progress and its
later checkpoint and disposition never assert known aggregate totals. Duplicate exact claims and
settlements are idempotent. Retry scheduling is bounded to five attempts with stable
identifier-derived jitter, while abort or a disabled runtime gate pauses work without treating an
empty or partial batch as withdrawal. Terminal output contains only fixed failure codes and
aggregate counts; raw errors and job/source values are never retained in a checkpoint or
disposition. A thrown failure marks aggregate progress as unknown instead of falsely asserting that
no earlier idempotent catalog write completed.

The runtime also accepts one asynchronous fail-closed source-execution gate. The current durable
composition binds it to the Jobs-owned exact source/adapter/config pause decision and rechecks it
before polling and around every catalog write. A newly observed pause stops subsequent writes and
settles the attempt as paused with truthful completed counts; one already issued idempotent write
may finish. A paused occurrence cannot resume while that immutable control remains present, while
terminal durable reconciliation continues independently.

The Jobs persistence adapter commits every `changed` checkpoint with an atomic compare-and-swap
against the command's expected revision before acting on its disposition. Losing that fence means
discarding the proposed transition and reloading authoritative state. A transport must likewise
never acknowledge, reschedule, or dead-letter work from an uncommitted transition.

The repository includes a source-neutral, default-off durable Lambda/SQS/Terraform composition
around this coordinator. Greenhouse, Lever, and Ashby configuration is an exact bounded structured
list, not an arbitrary URL or credential. Provider execution additionally requires the global
runtime gate, explicit provider authority, and private application networking with NAT egress.
Each source is independently enabled and pauseable; changing its company/tenant configuration
changes its immutable configuration digest. The general-ingestion development Terraform
configuration retains no enabled provider sources, and its runtime/provider activation gates
remain off; the separate D2 verification scope is described below. A prior bounded, attributable
Ashby acceptance run retained canonical projections with exact provenance; it retained no raw
provider snapshots and does not authorize another provider request or an enabled source.

Run unit tests with `pnpm --filter @ai-job-apply/ingestion-worker test`. PostgreSQL integration
requires an explicit `DATABASE_URL` and is separate from the default suite.

`pnpm test:d2-provider-pairing` runs generated page/API pairs through the actual browser inspector,
detector, selected payload, normalizer, provider adapters, and verifier. It uses an isolated local
browser context and mocked provider responses, not a live provider or authenticated contribution.
This catches cross-component representation errors that isolated detector/adapter unit tests miss.
`pnpm test:d2-contribution-intake` separately exercises the browser-free sanitizer/request/intake
seam, including complete descriptions and the unchanged 65,536-byte UTF-8 Gateway request limit.
It is now included in `pnpm check` and the maintained repository verifier. The client refuses an
oversized complete request before queue insertion or consent creation while retaining editable
field selection; it does not truncate or silently deselect the description. These checks use
generated data and mocked persistence, not live publication or installed acceptance.

Contribution verification defaults to no registrations. The separate D2 scheduled runtime's
controlled state-336 activation preserves the accepted Greenhouse and Supermove/global-Lever
registrations and adds only the supplied hosted Ashby board. D2-060's compatible description code
then verifies at state `338` from source `dccbb65`, Gateway/scheduled/Trust versions `66`/`26`/`20`,
with zero meaningful Terraform changes. That is the earlier D2-060 release, not deployment
evidence for D2-061's new complete-description aliases. The separate general-ingestion runtime was not redeployed. Three exact
sources/verification registrations serve four allowed contribution hosts: the two existing
Greenhouse hosts, `jobs.lever.co` and `jobs.ashbyhq.com`. EU Lever, custom-domain detection,
production/store distribution and the general ingestion runtime remain disabled. Every registration
requires an enabled reviewed adapter, explicit provider authority, and an exact verification/source-policy
binding. Repository fixtures and synthetic tests alone do not authorize a provider or live host.
The [Phase 2 rollout](../../../docs/product/delivery/phase-2-extension-and-community.md#d2-035--ashby-development-rollout) owns the
current release and acceptance evidence, including the user's Lever Processing `published` /
Trust `accepted` report; the Lever website visibility/details/source journey remains unconfirmed.
D2-R22's acquisition/source-binding/deployment blocker is closed. Installed Ashby preview,
delivery, Trust and publication acceptance remain under D2-035. Reviewer assignments are unchanged;
this activation includes no Ashby Trust decision and does not complete Phase 2.
