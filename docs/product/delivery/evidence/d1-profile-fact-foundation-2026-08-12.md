# D1 Profile-Fact Foundation — 2026-08-12

## Outcome

The first D1-002 vertical slice is implemented and locally verified. An authenticated candidate
can create, list, correct, or reject explicitly entered profile facts through the web BFF and
gateway. Corrections append a new PostgreSQL version under optimistic concurrency rather than
overwriting the prior value.

D1-002 remains in progress. This evidence does not claim deployed acceptance, resume upload or
parsing, proposed-fact confirmation, production candidate-data approval, or completion of the
progressive onboarding experience.

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

## Remaining D1-002 work

1. Merge, publish the immutable migration/runtime artifacts, apply `0004` in development, and run
   authenticated owner/isolation/version acceptance before enabling the UI as deployed behavior.
2. Add encrypted base-resume object handling, strict file/type/size and malware boundaries,
   normalized document representation, and asynchronous parsing without resume text in telemetry.
3. Present proposed parsed facts with confidence and supporting spans; require explicit candidate
   confirmation or rejection, especially for low-confidence values.
4. Expand progressive onboarding preferences and calculate readiness from confirmed facts plus
   discovery constraints without treating optional data as a blocker.
