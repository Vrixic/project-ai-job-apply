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
- `runner.ts` — allowlisted observation mapping, Jobs-domain validation, batch collision checks,
  idempotent catalog-port calls, and aggregate-only results.
- `synthetic.ts` — deterministic generated `.example.test` observations representing no provider,
  employer, tenant, or real job.

An empty batch or source acquisition failure never proves that a stored job is closed. Unexpected
adapter failures become a redacted retry result and do not call the catalog. Catalog contract or
identity failures propagate so durable orchestration can stop and alert instead of retrying an
invalid payload forever.

Run unit tests with `pnpm --filter @ai-job-apply/ingestion-worker test`. PostgreSQL integration
requires an explicit `DATABASE_URL` and is separate from the default suite.
