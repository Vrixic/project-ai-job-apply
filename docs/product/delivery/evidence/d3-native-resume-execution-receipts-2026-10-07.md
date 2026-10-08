# D3 original resume execution receipts - 2026-10-07

D1-013/D3-064/D3-079 remain In progress. Applications previously validated the original durable
execution ARN but discarded it when marking resume delivery published. The store now retains
that exact ARN atomically with publication and distinguishes `started` from `no_resume`.

Forward migration `0011_native_resume_execution_receipts` adds two nullable metadata columns,
a binding constraint, an immutable receipt trigger and an original-version scan index to the
existing Applications outbox. No new relation or candidate content is introduced. Started receipts
must bind the stored numeric function and `resume-<original event ID>` execution name. Receipt
capture requires the live original delivery lease. Missing results remain unknown, including
historical published rows; no ARN, outcome or successful execution is backfilled by inference.

The private `executionReceipts` read supplies at most 25 scalar records for one exact numeric
version with event-ID keyset pagination. It does not require active candidate admission because
recovery must still work after quarantine. It has no execution, task, DNS or packet write port.
A recovery consumer must cycle complete passes rather than retain a permanent event-ID high-water
mark: an older pending row can acquire its receipt later. Rows without receipts are not evidence
of non-dispatch; terminal messages remain hints until compared with this owner and AWS metadata.

## Compatibility and ownership

Migrate before deploying the new store. Old code can still publish null receipts, which remain
explicitly ambiguous; rollback does not erase receipts already captured. Existing terminal outbox
guards reject replacement. Candidate deletion still removes the owning outbox through its existing
path; no separate content/export store is added. Public API and event contracts are unchanged.

The executable migration, restore manifest/checksum, Dockerfile inventory, publisher/runtime smoke,
restore operator counts and current migration-success fixtures advance together to 74 migrations
and 93 relations. Historical deployed receipts and images are unchanged. The existing local
73-migration image is not a release candidate for this schema; a fresh image remains required.

## Verification

Applications and Workflows TypeScript builds pass. All 65 real PostgreSQL resume integration cases
pass in a new disposable PostgreSQL 16.6 fixture, including immutable original receipt capture,
exact-version/keyset reads, quarantine recovery, unknown/no-source distinction and forged binding
refusal. Fifty migration/restore tests pass. Staging restore-operator guards pass with no cloud
calls. The production runtime-smoke/publisher and source-bound migration-operator checks are being
completed at the committed checkpoint; their final results are recorded below.

The first package check caught an outdated Dockerfile count and CRLF bytes in the new SQL file;
the count was advanced and the SQL normalized to its canonical LF checksum. The source-bound
operator test reads committed HEAD, so it must run after this migration checkpoint is committed.
No managed migration, published image, cloud mutation, full verifier or fresh dependency audit.
Prior dependency findings remain open. CI/CD deferred; PC remains on.

## Remaining work

Wire the bounded receipt inventory to exact AWS execution metadata and a durable recovery record,
including unknown launch acknowledgements and missed terminal events. Receipt retention alone is
not reconciliation and never permits another execution. Hostname/TLS, managed release/recovery and
client acceptance remain. D1/D3 incomplete; ADR-040 remains Proposed.

## Final local checkpoint

At committed source `faa8b94d`, the source-bound document migration operator's path/baseline,
schema-8 two-receipt and schema-7 round-trip/adversarial checks pass. The publisher OCI guards and
all 183 production runtime-smoke regression cases pass on the aligned 74-migration inventory.
Focused Biome checks pass. The disposable SQL container was removed; Docker Desktop and WSL
were stopped and no WSL distributions remain running. The PC remains on.
