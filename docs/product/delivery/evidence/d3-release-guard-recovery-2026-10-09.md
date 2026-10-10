# D3 release guard recovery — 2026-10-09

The owner requested independent reviewer-agent checks. The reviewer separately verified the
Gateway and migration publications from merged source `ab4f6d2c7a733bfe436218cb41bc70da14c9e189`,
the bounded database restore and endpoint plans, live restored reader bindings, and the fresh
schema-7 baseline. This is engineering evidence, not capability or accountable acceptance.

## Release findings and repair (D3-089)

The release was refused before deployment. Capture compared raw boolean values with equivalent
lowercase `TF_VAR` strings using an incomplete list. A fresh semantically identical zero-change
seed passed without modifying historical evidence. The Gateway plan then contained exactly two
managed updates plus four deferred, no-input native identity reads; the guard incorrectly counted
those reads as extra release resources. Neither failed plan was applied or relabeled.

The repair normalizes all 45 declared root booleans, adding 15 missing flags. The existing inventory
regression correctly detected the stale list; malformed-input checks now cover every boolean.
The Gateway guard accepts only exact paired caller-identity/region reads for retained native
source/preparation release keys, with fixed provider, reason, empty inputs, unknown/sensitivity
shapes and no replacement paths. Managed changes remain limited to the reviewed Gateway release.
The independent reviewer found no blocking source issue and verified the original full failed
plan against the repaired guard without changing its evidence or applying it.

Focused checks pass: 180 boolean representation roundtrips, 180 effective flips refused,
1,755 malformed-input refusals and strict nonboolean preservation. All 687 release guard checks pass, including the
full four-read shape, single pairs, multiple retained keys and adversarial substitutions.
All 41 stages of `scripts/verify-phase0.ps1` pass in one invocation.

Three fresh real Chromium journeys pass: search through preparation/review/approval/manual Apply
and confirmed history; withdrawn-answer recovery; and sensitive-answer handoff/selection under
production extension CSP. They also cover preview expiry, disconnect and approved downloads.
Identity, service responses and native material are simulated; there are no employer effects,
live generation, installed-extension acceptance or provider confirmation claims.

## Managed evidence and limits

- Gateway publication: two identical builds, dependency audit, 379 tests; 133 opt-in SQL cases
  skipped. Independent exact-version/KMS readback passed. Artifact SHA-256
  `49f6d5511271e60540703b47775131751936ad213ced8119409b00ca55aa5600`.
- Migration publication: two deterministic builds, hardened networkless smoke, exact registry
  readback and completed scan with zero High/Critical findings. Platform digest
  `sha256:9fc204a0bd7872a830538dd5e217039e4d9b18c145c02b26be56ccaf092593df`.
  The boundary is seven owners, twelve schemas, 96 relations and 79 checksum-bound migrations.
- The existing encrypted database was restored privately with backups/deletion protection;
  reader environment and exact IAM database binding passed independent live readback.
- No Gateway release, migration execution, native candidate sign-in, preparation/download,
  provider action or live connected-journey acceptance occurred in this batch.

Fresh development shutdown was verified at 2026-10-10T01:15Z (2026-10-09 locally): zero database
instances, Interface endpoints, NAT gateways, Elastic IPs, application routes, ECS tasks, enabled
rules/mappings/schedules, running durable executions and queued messages. Three durable functions
and twelve queues were inspected. Fresh encrypted safety/final snapshots are available; an isolated
private physical restore passed and its temporary instance was removed. The final same-input
Terraform plan has zero resource or output changes. Exact dormant inputs, restore proof and
recovery manifest were archived with version/KMS/hash readback. Complete inputs, state, plans,
receipts and review logs remain in ignored private operator directories.

Staging retains its earlier dormant verification, with no subsequent mutation in this batch;
AWS access remains sequential. Docker/WSL are off and the PC remains on. Retained snapshots,
images, objects/logs, keys/secrets and DNS can incur charges.

D3 remains In progress. Current-source compatible deployment, live native/browser/installed
extension checks, authorized Greenhouse fixtures and first adapter, provider retention and
all-copy expiry, rights/restore and accountable reviews remain. Independent D1 acceptance,
including hosted admin acceptance, stays deferred. Published artifacts retain their original
source; this repair does not certify them against newer deployment source.
