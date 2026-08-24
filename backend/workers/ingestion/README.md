# Source-neutral ingestion worker

Owns the provider-independent worker contract that turns an explicitly enabled source adapter's
bounded, normalized public-job batch into Jobs-owned catalog observations.

The durable runtime is source-neutral and supports explicitly configured Greenhouse Job Board,
Lever Postings, and Ashby Job Board sources. Repository and environment defaults configure none of
them and keep provider activation disabled. The registry rejects an enabled provider unless the
runtime supplies explicit provider-activation authority; every source also has its own `enabled`
flag and exact Jobs-owned `sourceId + adapterVersion + adapterConfigSha256` pause gate. No real
board/site identifier, company configuration, schedule, queue mapping, egress, or provider data is
configured by default. Public UGC remains outside this worker and belongs to D2.

## Implemented boundaries

- `contract.ts` — strict adapter, registry, catalog-port, and aggregate-result shapes.
- `registry.ts` — immutable registration, duplicate rejection, and default-deny activation.
- `backoff.ts` — bounded deterministic retry delay calculation without source values.
- `orchestration.ts` — a provider-neutral protocol kernel for immutable schedule occurrences,
  revision- and lease-fenced attempt transitions, deterministic bounded retry jitter, kill-switch
  pause, and aggregate-only queue dispositions.
- `runner.ts` — allowlisted observation mapping, Jobs-domain validation, batch collision checks,
  idempotent catalog-port calls, and aggregate-only results.
- `synthetic.ts` — deterministic generated `.example.test` observations representing no provider,
  employer, tenant, or real job.
- `greenhouse.ts` — fixed-host public Job Board GET adapter with redirect refusal, bounded timeout
  and streaming response bytes, strict response mapping, plain-text conversion, tracking-query
  removal, and reviewed company/domain inputs. It is tested with generated responses and remains
  impossible to enable through the default registry policy without explicit runtime authority.
- `lever.ts` — fixed global/EU Postings GET adapter with paired API/hosted-job hosts, bounded
  pagination and overflow refusal, plaintext-only descriptions, tracking-query removal, and exact
  site/posting identity. It never calls Lever's application endpoint.
- `ashby.ts` — fixed public Job Board GET adapter with exact API version, listed-only projection,
  bounded locations and response size, documented work-mode/employment mapping, and exact
  board/posting identity. It requests no compensation data and never calls an authenticated API.
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
changes its immutable configuration digest. The development environment currently has no provider
configuration or real-provider data and remains disabled.

Run unit tests with `pnpm --filter @ai-job-apply/ingestion-worker test`. PostgreSQL integration
requires an explicit `DATABASE_URL` and is separate from the default suite.
