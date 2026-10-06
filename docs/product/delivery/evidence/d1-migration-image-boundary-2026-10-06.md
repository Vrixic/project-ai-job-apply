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

Cold image build, hardened actual-image smoke and full clean-source verification follow. The
image uses the existing pinned Node build/runtime bases and reviewed OpenSSL APK hashes; no
new image/dependency pin, schema, migration, API, frontend, Terraform or hosted CI/CD change.
The Docker context allowlist excludes environment files, credentials, caches and raw artifacts.
No ECR push, live database migration, runtime activation or phase completion is claimed.

This release blocker is addressed before the pending D3 native material-runtime image work.
CI/CD remains deferred until production launch; the PC stays on.
