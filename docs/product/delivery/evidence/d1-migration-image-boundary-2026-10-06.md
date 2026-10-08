# D1/D3 migration image boundary repair — 2026-10-06

Status: local implementation; D1/D3 remain In progress. No cloud release or activation.

The three Jobs retention/export migrations brought the accepted restore boundary to 69
migrations and 92 relations, but the migration Dockerfile and publisher's executable smoke
still pinned 66/88. The publisher SQL-name list was current; static operator tests did not execute
the stale manifest-count branch. The existing executable runtime-smoke suite also retained
its 66-migration setup assertion and was omitted from the full local verifier.

Before correction, that suite fails `69 !== 66`. After updating its setup, it exposes the real
publisher `restore manifest mismatch` refusal. Both the Docker build smoke and publisher now
pin 69/92. Docker's required-file check includes Jobs 0025, 0026 and 0027. Exact owner/schema,
SQL filename and SHA-256 checks remain unchanged; no dynamic fallback or permissive scope is added.

The existing executable runtime-smoke suite now runs from `scripts/verify-phase0.ps1`, catching
future inventory drift before handoff. All 173 executable cases pass, including every missing or
altered SQL migration, extra/replaced filenames and mismatched manifest entries/checksums.
Log: `.tmp/d1-migration-image-smoke-final.log`. Fixture execution uses real manifest/SQL files and
generated package roots; it opens no database and makes no cloud call.

Cold image build, hardened actual-image smoke and full clean-source verification pass. The
image uses the existing pinned Node build/runtime bases and reviewed OpenSSL APK hashes; no
new image/dependency pin, schema, migration, API, frontend, Terraform or hosted CI/CD change.
The Docker context allowlist excludes environment files, credentials, caches and raw artifacts.
No ECR push, live database migration, runtime activation or phase completion is claimed.

This release blocker is addressed before the pending D3 native material-runtime image work.
CI/CD remains deferred until production launch; the PC stays on.

## Verified local artifact

Committed source `dfa43da766b5f9c29fa485b4c5ae06fee91f97f0` was archived into a source-only
Docker context and built with `--pull --no-cache --platform linux/amd64` and its committed Unix
timestamp as `SOURCE_DATE_EPOCH`. The build-time restore package smoke passes. The resulting
local image is `sha256:bb6c9afbec3267ac93dffb087cf19260411d10cfad49ed5c8b74bc3147842058`,
Linux/amd64, user `65532:65532`, with its OCI revision bound to that exact source.
Log: `.tmp/d1-migration-image-cold-build.log`.

The publisher's exact inline smoke was extracted without modification and executed in that
image with `--pull never --network none --read-only --cap-drop ALL`,
`--security-opt no-new-privileges` and user `65532:65532`. It returns
`migration-runtime-smoke:ok`, checking all seven owners, executable entrypoints, 69 migrations,
92 relations and every SQL filename/checksum. No database, credentials or mounted artifacts
were supplied. Log: `.tmp/d1-migration-image-runtime-smoke.log`.

The full maintained `scripts/verify-phase0.ps1` passes on the same clean committed source,
with `ARTIFACT_SOURCE_SHA` explicitly set: 38 typecheck tasks, 39 test tasks and 23 builds,
including the 173 executable smoke cases, operator/security/isolation and Compose checks.
Lint remains zero errors, 15 warnings and 58 infos. Log: `.tmp/d1-migration-image-full.log`.
No tracked source was edited during that run. The isolated local web server was stopped before
session fixtures bound port 3000. Docker Desktop and WSL were stopped after the image smoke;
the PC remains on. Hosted publication, scan, migration and runtime rollout remain unclaimed.

After verification, the maintained local launcher restored web against the live development
API. Local root returns 200; unauthenticated Resume returns its expected 307 sign-in redirect.
Only the two inspected Next-generated development import changes were restored. These readiness
checks add no authenticated resume/preference acceptance or cloud state change.


## Observation migration package alignment (2026-10-07)

Documents 0015 advanced the owning restore manifest to 73 migrations/93 relations. The container
build smoke, publisher runtime smoke and their strict fixtures still expected 72 migrations and
omitted the new required SQL file. They now require the exact new filename and count; all existing
owner/schema/file/checksum checks remain in force. No base image, dependency or cloud setting changed.

All 181 executable runtime-smoke cases and the maintained OCI publisher guard suite pass locally.
Logs: `.tmp/d3-observation-migration-smoke.log` and `.tmp/d3-observation-migration-publisher.log`.
The first combined verifier at `254bde13` was deliberately stopped after discovering this guaranteed
later failure; it is not a full pass. A fresh clean-source verifier and actual updated image build
remain to run. No publication, vulnerability-scan, deployed migration or phase completion claim.


The clean `65976e1549d8d1a7c43e26429db509dae0e2e90b` verifier passed through document staged operator
checks, then found a separate stale Documents 0014 success-message fixture in the migration
operator suite. Correcting that expected message to 0015 passes the path/baseline and both
schema-7/schema-8 adversarial suites. This correction changes only a test fixture; the remaining
maintained verifier stages will run from the new clean commit. Earlier stages are not a claim
that this later commit ran the entire script uninterrupted. Logs:
`.tmp/d3-recovery-full-verification-final.log` and `.tmp/d3-observation-migration-operator.log`.

The same archived `65976e15` source builds cold with the committed Unix timestamp and pinned base
images. Local Linux/amd64 image `sha256:359c3d0cb68fe78fafd1c74d406a5b54a64d3e4db9d0c08fed9e7f8b1900a4ce`
passes both build-time package checks and the unchanged publisher runtime smoke. The latter runs
as UID/GID 65532, read-only, no network, all capabilities dropped and no-new-privileges. It checks
all seven owners, 73 migrations, 93 relations, entrypoints and exact SQL names/checksums, returning
`migration-runtime-smoke:ok`. No database, credentials or bind mounts were supplied. Logs/receipt:
`.tmp/d3-observation-migration-image-{build,smoke}.log` and
`.tmp/d3-observation-migration-image-receipt.json`. This is one local build, not reproducibility,
ECR scan, publication or migration execution evidence. Docker/WSL stopped after the smoke; PC on.


All final maintained stages pass at clean `5065427af41480c62730c0d69dc1b0ea213d6292`, including
retirement/content/caller/owner/launch/preparation emitted isolation and Compose/product-scope
validation. Log: `.tmp/d3-recovery-final-verification.log`; exit receipt is zero. Earlier stages
passed at `65976e15` (through document staged operators) and `66a2c3d1` (corrected migration
operator through export isolation, including 38 typecheck/39 test/23 build tasks). Only the two
identified test fixtures and evidence changed between these checkpoints; no runtime source edits
occurred during verification. This records all maintained stages in segments, not a single run.

The maintained local launcher restores development web against the live development API in
session 18829. Anonymous root returns 200 and Resume returns its expected 307; this is readiness,
not fresh authenticated acceptance. Only the inspected Next-generated development type-import
changes were restored. Docker and WSL are stopped; PC remains on. Publication, DNS/TLS/routing,
managed migration/runtime and accountable acceptance remain open; D1/D3 remain In progress.


## Current 75-migration image and logical recovery

2026-10-07 closes the local image refresh left by Applications 0012. Frozen source
`437794fc328d43f6dc337689dce6eaa985dd59af` was archived without workstation files and built with
`--pull --no-cache --platform linux/amd64`, the committed `SOURCE_DATE_EPOCH`, and its full source
revision label. No image/dependency pins or production runtime source were changed in this batch.
The existing context allowlist still excludes credentials, environment files and generated data.

The local image `ai-job-apply-migration:local-437794fc` has inspected image ID
`sha256:36be80aa2cd971d427181e6d49517f653d3039974e3eb30b119d71a28bcd964f`, Linux/amd64,
UID/GID `65532:65532`, and the exact source revision above. The publisher's unchanged inline
runtime smoke passes with network disabled, read-only root, all capabilities dropped and
no-new-privileges. Its exact filenames/checksums and packaged restore inventory are
**75 migrations, 93 relations, 12 schemas and seven owners**.

The actual packaged migration runner then applied every owner's migrations to a fresh disposable
PostgreSQL 16.14 database and replayed them successfully. Both passes emit all seven owner success
markers plus aggregate success. The image's read-only restore verifier independently confirms
75 migrations/93 relations afterward. The test containers share only an isolated loopback network
namespace with external networking disabled; the database uses tmpfs. Only generated local
credentials were supplied. No host database, production data, managed TLS or AWS identity was used.

Inspection also found the maintained logical recovery harness still pinned to 66 migrations/88
relations. Its four inventory assertions/result counts now match 75/93, and the database-migrations
README reflects the current source. No restore, owner-isolation or cleanup guard was weakened.
`pnpm test:d2-recovery` passes: 14 build tasks, 15 disposable-container boundary cases, fresh and
replayed seven-owner migrations, real custom-format pg_dump/pg_restore, aggregate verification and
exact sorted full-row comparison across all 93 relations. Its 18 required D2 relations contain
generated data; existing response, temporary/restricted packet, native-launch, consent, lease and
owner-isolation behavior checks pass. Source rows remain unchanged and cleanup succeeds. This
covers the existing generated scenarios, not every state of every newly added relation.

Local logs/receipts are `.tmp/migration-image-437794fc-{build,smoke,fresh,replay,verify}.log`,
`.tmp/migration-image-437794fc-inspect.json`, and `.tmp/migration-75-logical-recovery.log`.
The disposable databases were removed; Docker Desktop and WSL stopped, PC on. The running
Windows development server was preserved.

This is one local cold build and logical recovery proof. Reproducible publication, vulnerability
scan/disposition, cloud migration, managed PITR/RTO/RPO and runtime activation remain pending.
The known production dependency audit failure is not waived, and the publisher's complete release
gate was not run or claimed. D1/D3 remain In progress; CI/CD remains deferred.


## Current 76-migration image execution

2026-10-07 refreshes the local image after Documents 0016. Clean source
`18698f7f3232e6b3c626069f8057ddab1c496302` was archived without workstation files and built
for Linux/amd64 with `--pull`, the committed `SOURCE_DATE_EPOCH=1791426941`, and its source label.
This build may reuse unchanged Docker layers; no cold-build or reproducibility claim is made.

Tag `ai-job-apply-migration:local-18698f7f` has inspected image ID
`sha256:cbad1b26d8552a2807afd952b9817cccdb5ef19aa6ceba0eae987d5353320c56`, platform manifest
`sha256:55f1d27230d71c18b8d25576599f0258a91256191bc9c98abe1cf557ff134476`, and image config
`sha256:4992e9bfc975c99176ba80d855de58259bd7ca1fbb18c204c39b444fb75fc42f`.
Inspection verifies exact source label, Linux/amd64 and UID/GID 65532:65532.

The publisher's current runtime smoke passes with networking disabled, read-only root, all
capabilities dropped and no-new-privileges. The actual image then applies all seven owners to a
fresh disposable PostgreSQL 16.14 database and replays successfully. Both passes emit seven
owner success markers and aggregate success. Its packaged read-only verifier confirms exactly
76 checksum-bound migrations and 93 relations. Execution shares the database's network-none
namespace; data is tmpfs and credentials are synthetic. No managed TLS or AWS identity is used.

Logs: `.tmp/migration-18698f7f-{build,smoke,fresh,replay,verify}.log`; image inspection:
`.tmp/migration-18698f7f-inspect.json`. The disposable database was removed and Docker/WSL stopped.
This refreshes local image execution evidence, not the earlier logical dump/restore drill,
managed PITR, vulnerability disposition, reproducible publication or release approval.
D1/D3 remain In progress, CI/CD deferred and PC on.
