# D3 original native read allocation discovery — 2026-10-06

Status: default-off owner source and local PostgreSQL evidence; D1/D3 remain In progress.

`PostgresNativeMaterialReadyStore.readAllocation` looks up the original allocation from an exact
TemporaryMaterialReference. It validates and captures the reference before awaiting SQL, requires
active candidate identity, matches owner/application/generation/version/hash/original completion
and expiry, and joins only Documents-owned readiness, settled successful provider-dispatch work,
bound claimed original task and the current unsealed admission epoch. Database time checks the
original expiry again before returning, and flag withdrawal withholds metadata. Unique document
and work allocation constraints make the result unambiguous. The response is only an allocation
UUID; no task ARN, content, credentials, launch, renewal or liveness authority is returned.

The caller must authenticate ownership and current packet before using this internal lookup.
This is point-in-time discovery; the native HTTPS path independently rechecks packet and original
admission on every read. No lock spans a remote call. Public contract/route, endpoint configuration,
managed DNS/TLS/networking and browser token handoff remain unfinished. No frontend, shared
schema, migration, image, infrastructure or cloud activation is changed by this owner step.

The Documents build passes. All 25 actual PostgreSQL launcher/owner integration cases pass,
including second-version allocation discovery, no readiness, default off, changed application,
generation, version, hash and original times, inactive/unknown identity, flag withdrawal and sealed
admission. These assertions extend the actual authenticated native-ready/preparation flow and
retain its one-RunTask inventory assertion. PostgreSQL 16.6 runs in a newly owned loopback tmpfs
fixture with four actual owner migrations applied twice; AWS/Lambda/ECS/provider/KMS ports are
synthetic. Log: `.tmp/d3-native-read-allocation-sql-final.log`.

Full clean-source verification passes at `4c708af8228dbd07f2d4f8b9584fa9ec2128bcb5`: 38 typecheck,
39 test and 23 build tasks, formatting/operator/security/Compose checks and all emitted isolation
checks. Lint remains zero errors, 15 warnings and 58 infos. The original verifier handle completes
with exit zero; tracked source is unchanged throughout the run.
Log: `.tmp/d3-native-read-allocation-full.log`. The exact owned tmpfs fixture is removed after its
ownership label is checked; Docker/WSL are stopped and shared volumes retained. No public endpoint, provider acceptance, deployed
migration, production readiness or phase completion is asserted. CI/CD stays deferred; the PC
stays on.

The isolated web is restored against the live development API: home 200, anonymous `/resume`
307. The two Next.js-generated development imports are restored after exact diff inspection.
New evidence links resolve. Two historical master-tracker links to the removed foundation form
are pre-existing; no new broken link is introduced. No sign-in or accepted D1 step is repeated.
