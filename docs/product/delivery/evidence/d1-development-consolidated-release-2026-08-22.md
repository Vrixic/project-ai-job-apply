# D1 development consolidated release — 2026-08-22

## Scope

- Environment: development
- Source revision: `0696b2af0ea8338e723b774b6b842a10e6c75f34`
- Release posture: CompleteDark; provider schedules, document triggers, and the anonymous public route remain disabled
- GitHub Actions: intentionally excluded from this operator sequence

This release moves the current merged Phase 1 backend and migration composition into development.
It does not activate real providers, real candidate data, public indexing, document processing, or
the administrative browser application.

## Immutable inputs

- Gateway publication receipt:
  `receipt-0696b2af0ea8-20260822-153300.json`
- Gateway receipt SHA-256:
  `9b50a62c2f2451b59e270b34d0e4d654f880342f01f1594a379d32e323ccc9a6`
- Migration-image platform digest:
  `sha256:de4066f33e54b9da5a93d29e713bf017097fd9b80d66adefb7810d0fd6d73645`
- Migration-image index digest:
  `sha256:ddf6137253bfd2e569252231177a2768ec4622e5dd714d5086a9bb5cb3ecbccd`
- Migration-image publication receipt: `receipt-0696b2af0ea8.json`
- Migration-image receipt SHA-256:
  `e3606b5820a7062804db01536569b3d5e9285d6d4ccc5ddc8a8eb9ab40a8a9ec`
- ECR enhanced scan: `COMPLETE`, zero High, zero Critical

The migration image passed two deterministic builds, hardened runtime smoke, immutable ECR
readback, and the completed ECR scan. The migration set did not change in this source range, so no
database migration task was executed.

## Plan and apply

The retained historical single-purpose operators rejected the current consolidated baseline. A
saved Terraform plan was therefore built from the accepted development baseline, overlaid only
with the exact immutable gateway artifact and migration image above, and validated before apply.

- Applied plan SHA-256:
  `63794ec411f7f6e53deb0fd7ce7ebf9e1b32eb9e3ce4b8809451ace2b4e147d7`
- Allowed addresses: gateway route, gateway Lambda function, gateway Lambda alias, and migration
  task definition only
- Apply result: one resource added, three changed, one destroyed through task-definition
  replacement
- Gateway immutable alias: version `19`
- Migration task definition: revision `12`
- Resulting Terraform state serial: `111`

Validation proved that the route change was limited to the exact seven accepted scopes
(`documents:read`, `documents:write`, `jobs:moderate`, `jobs:read`, `jobs:write`, `profile:read`,
and `profile:write`), the task change was limited to the migration image, the public route remained
disabled, and document triggers remained disabled.

## Deployed verification

- Existing authenticated boundary matrix: 24/24 passed
- Focused moderation boundary: 4/4 passed
  - moderator case search: `200`
  - candidate scope on moderation route: `403`
  - missing authorization: `401`
  - missing-job aggregate summary: `200` with zero aggregate
- Operator identity was not projected to clients
- No persistent writes were made by the verification
- Post-release refresh-backed Terraform plan: zero drift
- Post-release plan SHA-256:
  `04972ccb189012c71cd30b25715a79f073b587918d86621b2d60465dd4ee783f`
- Running ingestion tasks: zero

## Remaining gates

This is backend deployment evidence, not Phase 1 completion. The following remain deliberately
unclaimed and disabled:

- managed administrative OIDC client/grant and hosted admin UI;
- accountable moderation, retention/deletion, alert-threshold, takedown, and appeal decisions;
- real provider permissions and source activation;
- ADR-023 acceptance and real-resume trigger activation;
- anonymous public-route activation and structured-data completeness;
- representative deployed load/SLO acceptance;
- separately authorized AWS PITR/object recovery;
- human accessibility, security/privacy, and product acceptance.

