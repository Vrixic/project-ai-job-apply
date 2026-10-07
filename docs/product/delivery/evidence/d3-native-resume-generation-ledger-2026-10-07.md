# D3 native resume generation ledger — 2026-10-07

Status: default-off owning source and local SQL/restore evidence; D1/D3 remain In progress.

Documents now owns original deterministic resume-generation metadata independently of cover-letter
provider grants. The private generation store captures closed nested owner/application/base/job/
packet intent, requires same-transaction Applications and Jobs owner ports, and admits only the
selected parsed, active, unheld source with its exact version/source/normalized hashes. Production
Jobs and authenticated resume RPC composition remain required; no fallback owner authority exists.

Migration 0014 adds one scalar-only table: original identity, packet/job/base commitments, immutable
allocation/deployment and one launch claim, exact task bind, original completion/hash/absolute
30-minute expiry, ready timestamp and positive retirement metadata. No source bytes, normalized
text, generated blocks/diffs/files, provider work/consent, tokens or credentials are stored.

The owning application fence serializes cover-letter/resume reservations, including SQL-only
writers. A sealed epoch cannot reopen while either material kind has an unretired allocation.
The existing cover-letter disposal confirmation now includes resume rows. Original source/account
row deletion refuses pending/bound generations; authorized account deletion includes the new rows.
Pure unlaunched reservations can be abandoned only while no launch claim exists, allowing deletion
without inventing a stopped-task receipt. Once claimed, missing/lost acknowledgements never permit
abandonment, redispatch or replacement. Only a separately trusted exact-task observer may provide
retirement. Test receipts are synthetic and do not prove managed task death.

Reservation retries return the exact original record; changing base/packet/deployment intent fails.
Concurrent launch retries consume exactly one claim before external work. Original task/config
binding cannot be replaced. Positive metadata recovery remains available after seal/quarantine but
grants no generation/read authority. Task admission pins exact allocation/config/current owner/base/
job state. Completion claims once; acknowledgement retries cannot renew timestamps or alter hash.
Readiness is published only after the trusted renderer verifies both formats. The ledger stores
that scalar acknowledgement and does not itself inspect files. Native session rendering is covered
by the prior actual-process evidence; it is not newly integrated by this owner store.

Allocation lookup returns only the exact original ready, bound, current-source/job and unexpired
reference. Current packet authorization is explicitly the surrounding transport's before/after
boundary; preparation revision is not reused as read authority after packet changes. No public
route, native task listener, source reader, RunTask adapter, private Lambda artifact, image or
managed endpoint is enabled in this batch.

Candidate export gains optional closed `nativeResumeGenerations` metadata, with paired completion
fields and no deployment/grant/content fields. Old strict consumers reject this additive property:
roll out current schema consumers before applying 0014 or enabling exports from it. Apply the
migration before the owner store; leave native resume activation off until authenticated task/RPC,
source/Jobs/packet/bootstrap/render-ready/stop/client/ATS and accountable acceptance are complete.
Rollback code must preserve this inventory, deletion refusal and original-completion guards.

Local evidence:

- Documents build and two default-off/closed-input/error tests pass.
- Fifteen actual PostgreSQL 16.6 cases pass twice on final source. Applications admission is the
  actual emitted owner port on the same transaction. Jobs proof and task observation are synthetic.
  Cases cover exact reservation/replay, one concurrent launch claim, immutable task/config/base,
  unbound/future/expired completion refusal, original completion/retry/ready/location, sealed lost-
  ACK recovery, exact positive retirement/reopen, cancellation only before claim, caller mutation
  capture, post-insert withdrawal rollback, held/quarantined/stale admission, scalar export, both
  directions of cross-kind exclusion and refusal of premature application disposal.
- All 25 existing native cover-letter SQL composition cases pass with current 0014 in a separate
  owned cluster. AWS/provider/KMS transport remains simulated. The initial shared-cluster fixture
  exposed the existing reader-role rule that prohibits grants to another database; using an
  independent generated cluster preserves that rule. No production role check is weakened.
- All seven owners migrate successfully. The current boundary is 71 migrations, 93 relations,
  12 schemas and seven owners. Manifest SHA:
  `05e8fc5eb882f63ec0266e31ec9f820cffe88e05ef6daa97fe50becbaf763064`.
  The operator validator, private deletion replay validator and synthetic fixture pin this exact
  checksum. Old receipts remain historical; old migration checksums are unchanged.
- Actual pg_dump/pg_restore into a separate generated database passes the maintained read-only
  aggregate verifier. All 25 scalar generation rows match exactly, including original task/hash/
  completion/retirement metadata. Restored completion mutation and read-only writes are refused.
  This is local logical restore, not managed RDS snapshot or deployed recovery acceptance.
- Fifty migration/restore unit cases, 28 domain cases and restore operator guards pass. Historical
  fixture projections exclude the new migration/table and retain their original counts.
- Six emitted composition cases pass. New owner bundle has scalar generation/region/domain
  validators and excludes model, rendering/parser/content store, AWS clients and task/listener
  capabilities. Its bundled default-off path performs no SQL or owner calls. An initial required
  wrapper-file assertion was corrected to the actual emitted shared domain validator, retaining
  capability exclusions.
- Contract generation twice produces no generated API diff. Full clean-source verification follows.

Logs: `.tmp/d3-native-resume-ledger-{build,units,sql-final,cover-sql,domain,restore-units,
restore-guards,logical-restore,bundle}.log`. Owned tmpfs fixtures and container-held generated dump
are removed after SQL work; shared volumes remain and Docker/WSL stop. PC stays on. No cloud
publication/activation, main merge, new PR or hosted CI/CD work. ADR-040 stays Proposed.

The revised generated deletion-restore fixture pins the framed canonical environment digest and
its dependent inspection digest, rather than an unframed config-JSON hash. All 207 restore contract
cases and 697 replay guard checks pass with zero cloud calls. Local evidence links resolve and
scoped source formatting/lint passes. Both exact labeled SQL containers are removed; Docker/WSL
are stopped. The development web listener is already absent before the full verifier; restore
it afterward. No PC shutdown is performed.

## Exact release inventory correction

The first full run at `6da8ea28` stops at the coordinated release guard, which still admits
Documents only through 0013. The guard now explicitly admits the exact 0014 suffix; historical
boundaries retain their original lists, and unknown/duplicate/missing/reordered 0014 variants
refuse. All 273 release-guard assertions pass. The migration publisher's executable smoke now
requires exactly 71 migrations/93 relations and the named 0014 file, with manifest checksum
verification unchanged. Its current-image smoke tests and the document migration operator's
current 0014 success marker are synchronized. This changes inventory recognition, not deployment
approval or cloud state. A corrected committed-source full rerun follows.

## Full corrected frozen-source verification

Clean source `dcf4a3e07ac2f112a50e205be1df699b6e410d20` passes the original corrected
`scripts/verify-phase0.ps1` run with matching ARTIFACT_SOURCE_SHA and terminal exit zero.
All 38 typecheck tasks, 39 workspace test tasks, 23 builds and operational/security/formatting/
artifact-isolation/Compose/scope checks pass. The new scalar generation-owner emitted isolation
and bundled default-off refusal pass in the full run. Lint remains zero errors, 15 warnings and
58 infos. Tracked source stays unchanged while the original verifier is alive. Log:
`.tmp/d3-native-resume-ledger-full.log`; initial stopped run is retained separately.

The corrected executable migration smoke passes all 177 cases against the exact named 71-
migration inventory, including missing/extra/replaced/changed SQL and checksum refusal. It is
source/runtime smoke with generated files, not a newly built/published migration image. The
actual local 71-migration/93-relation logical restore and 15/25 SQL suites remain separate evidence.
No hosted CI/CD, managed 0014 migration, native resume production image or deployed acceptance.

Restore the maintained development web against the live development API afterward. D1/D3 remain
In progress, ADR-040 remains Proposed, and the missing authenticated resume task/RPC/Jobs/source/
packet/image/client/ATS composition and managed/accountable gates remain explicit. No new PR,
main merge, publication or cloud activation. Owned containers/dump are removed, shared volumes
remain, Docker/WSL stay stopped and the PC stays on.
