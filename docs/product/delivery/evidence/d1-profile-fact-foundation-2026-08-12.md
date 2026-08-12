# D1 Profile-Fact Foundation — 2026-08-12

## Outcome

The first D1-002 vertical slice is implemented, deployed, and accepted in the synthetic-only
development environment. An authenticated candidate can create, list, correct, or reject
explicitly entered profile facts through the web BFF and gateway. Corrections append a new
PostgreSQL version under optimistic concurrency rather than overwriting the prior value.

D1-002 remains in progress. This evidence does not claim resume upload or parsing, proposed-fact
confirmation, production candidate-data approval, or completion of the progressive onboarding
experience.

## Boundaries implemented

- OpenAPI defines owner-scoped list/create/correct commands with generated TypeScript types,
  strict values, required sensitivity, exact scopes, idempotency keys, and expected-version
  concurrency.
- Direct user entry is server-labeled `confirmed` with `source.type=user` and the non-sensitive
  `direct-entry` reference. Clients cannot claim resume/import provenance or silently create a
  proposed extraction.
- PostgreSQL separates stable fact identity from append-only versions. The user row owns the fact;
  account deletion can cascade both tables, while a database trigger rejects in-place version
  updates with SQLSTATE `55000`.
- Create and correction commands are transactional and idempotent. Corrections lock the stable
  fact row and reject stale expected versions. Audit metadata contains only fact ID and version,
  never the candidate value.
- Read and write paths resolve the authenticated candidate and filter by internal owner ID.
  Cross-user correction returns indistinguishable not-found behavior.
- The Lambda adapter admits only exact list/create routes and structurally valid UUID correction
  routes, preserves the validated API Gateway principal, and applies the existing JSON/body-size
  boundary.
- The Next.js server attaches the access token; browser code receives no token. The responsive
  truth-profile panel lists the latest versions and supports direct entry, correction, and
  rejection with explicit truth language.

No durable workflow or event was added: these are bounded synchronous state changes with no
approved downstream consumer. Resume binaries and parsed artifacts will use the Documents/Profile
boundary in the next slice rather than being placed in profile JSON, events, or logs.

## Verification

- API-contract tests: 6/6 passed.
- Domain schema tests: 3/3 passed.
- Gateway tests: 44/44 passed, including exact Lambda list/create/correction admission and
  malformed correction-route rejection.
- Web tests: 40/40 passed.
- Next.js production build and route generation passed, including both profile-fact BFF routes.
- A fresh disposable PostgreSQL 16 database applied and replayed profile migrations through
  `0004_profile_fact_versions`; all four integration cases passed, including owner isolation,
  exact idempotent replay, stale and concurrent-version rejection, three retained versions,
  database-enforced value constraints, and in-place update rejection. The disposable database was
  then deleted and the local PostgreSQL container returned to its prior stopped state.
- The complete repository check passed: skill and serverless-infrastructure validation,
  formatting, lint, all 22 type-check/build dependency tasks, and all 23 unit-test tasks.

## Development artifact publication

Merged source commit `5bc9980d154727c10e8f641304c07006561eda9c` was rebuilt reproducibly and
published without changing a runtime, route, trigger, task definition, database, or traffic
alias. The checksum-reviewed publication plan was
`4ca178f5b48fba163b7d8163196ebb450fe687da65694a127e4cf151b9104206`.

- The gateway ZIP SHA-256 is
  `465fe2bf1002d069e465e20ec8aff1229831efb37eb628de4d778e1c2d6e0195`; its
  versioned ZIP, CycloneDX SBOM, manifest, and checksum are the only objects under the exact
  source-and-artifact-bound S3 prefix. All four are KMS encrypted and have no delete marker.
- The migration image tag is the full merged source commit and resolves immutably to
  `sha256:4b367a8ee5fe546c1b31a7864bf8b7a14b3a513f6cdef3c8a5993d7487424fe7`.
  Its runtime manifest is Linux/AMD64; the additional OCI manifest is provenance attestation.
  The runtime image scan completed with zero Critical and zero High findings.
- Post-publication inspection confirmed the development gateway alias still points only to
  version `11`. Publication alone did not expose the new profile-fact routes.

## Development database migration

Terraform plan SHA-256
`bccce74c724504edf857d29702d23601455b126be2a327f09ee651010cff4f27` replaced only the
dormant one-off migration task definition using create-before-destroy. Revision `7` retained
Fargate, `awsvpc`, Linux/AMD64, 256 CPU units, 512 MiB memory, a read-only root filesystem, no
application task role, and only the managed `DATABASE_URL` secret. No task or database change
occurred during that apply, and its immediate refresh-backed plan reported zero drift.

Execution plan SHA-256
`4fc15d252210cb5be5def002a20d7a89dbf3e7c626215dd3c237eb27620b8a48` authorized exactly
one default-command task on revision `7`. Task `9a028fbbd80745b9b2b736dfc9b8d46a` used the reviewed
digest, ran for 25 seconds, and exited `0` without retry. Its three aggregate-only log events
confirmed profile migrations through `0004_profile_fact_versions`, jobs migrations through
`0003_duplicate_resolution_audit_guard`, and completion of all service-owned migrations.

Afterward, ECS returned to zero running and pending tasks, RDS remained private, encrypted,
available, deletion-protected, covered by seven-day automated backups and current PITR, all 16
metric alarms were determinate and non-`ALARM`, API checks returned `200/200/401`, gateway alias
`11` remained unchanged, and refresh-backed Terraform plan SHA-256
`1bb72285880a0c9409b191782240a773d5aac5d8ca0393a04460994d927dda0d` reported zero drift.

## Development gateway release

Terraform plan SHA-256
`556fa88f53661c281f2d65485d9b488ac599597c06df8e7d4954daf83030f112` updated exactly the
gateway Lambda function and its development alias in place. Alias `12` now points only to the
reviewed gateway ZIP; it has no weighted routing. The published function is active on Node.js 24
and X86_64, and its Lambda code hash and aggregate release marker match the reviewed artifact.

Post-release checks returned `200/200/401` for liveness, database readiness, and an unauthenticated
profile-fact read. The bounded version-12 log stream contained 21 platform events with zero
error-like or restricted credential-pattern matches. All 16 development metric alarms remained
determinate and non-`ALARM`. Refresh-backed Terraform plan SHA-256
`5c4da5b0995b8418d66720a9764d873be715d4ff7ab36c9a892447bd5d9095e9` reported zero drift.
The release itself did not claim authenticated candidate ownership, versioning, or cross-user
acceptance; those product-owner checks were completed separately below.

## Authenticated product-owner acceptance

The product owner completed the deployed two-account browser acceptance through the local
server-held-token web client against development alias `12`:

- account A created one synthetic confirmed skill fact at version `1` and a full refresh loaded it
  from deployed persistence;
- correcting the fact produced version `2` with the new value;
- rejecting it produced version `3` with rejected status; and
- account B could not see account A's fact.

The local BFF log recorded one `201` create, persisted `200` reads, and two successful `200`
patches without logging fact values or identity/token material. This closes the deployed
direct-entry persistence, append-only correction/rejection, and cross-user isolation acceptance
gate for the first D1-002 slice.

## Remaining D1-002 work

1. Add encrypted base-resume object handling, strict file/type/size and malware boundaries,
   normalized document representation, and asynchronous parsing without resume text in telemetry.
2. Present proposed parsed facts with confidence and supporting spans; require explicit candidate
   confirmation or rejection, especially for low-confidence values.
3. Expand progressive onboarding preferences and calculate readiness from confirmed facts plus
   discovery constraints without treating optional data as a blocker.
