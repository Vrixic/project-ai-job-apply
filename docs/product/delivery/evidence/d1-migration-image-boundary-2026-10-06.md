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
