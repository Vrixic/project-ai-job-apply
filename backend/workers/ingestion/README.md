# Source-neutral ingestion worker

Owns the provider-independent worker contract that turns an explicitly enabled source adapter's
bounded, normalized public-job batch into Jobs-owned catalog observations.

The current foundation is synthetic-only. Its immutable registry is disabled by default and its
default activation policy accepts only the neutral `other` provider with `authorized_fixture`
provenance and a `synthetic-*` source identifier. It contains no network client, configured
real-provider adapter, schedule, queue consumer, or deployed entrypoint. Real public feeds, public
UGC, and real-provider data remain outside this package and disabled behind their owning approval
gates.

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

The Jobs persistence adapter commits every `changed` checkpoint with an atomic compare-and-swap
against the command's expected revision before acting on its disposition. Losing that fence means
discarding the proposed transition and reloading authoritative state. A transport must likewise
never acknowledge, reschedule, or dead-letter work from an uncommitted transition.

The repository now includes a source-only, default-off durable Lambda/SQS/Terraform composition
around this coordinator. That composition is not published, deployed, scheduled, mapped, or
activated by this source packet. Its only source ID remains `synthetic-foundation-v1`, backed only
by the `synthetic-ingestion-v1` generated-synthetic adapter. Greenhouse,
Lever, Ashby, public network acquisition, and real-provider data remain absent and disabled.

Run unit tests with `pnpm --filter @ai-job-apply/ingestion-worker test`. PostgreSQL integration
requires an explicit `DATABASE_URL` and is separate from the default suite.
