# D1 current dark release, migration, and recovery — 2026-08-25

## Disposition

The complete technically deployable Phase 1 backend candidate is now immutably published,
default-dark in development, migrated through the current schema boundary, verified at the live
runtime boundary, and covered by a fresh isolated PostgreSQL point-in-time recovery exercise.
Public routes, indexing, provider schedules, document triggers, candidate-rights execution, and
real-candidate use remain disabled.

The application artifacts and migration image are bound to exact release source
`9abcebb5c2577d09b789ad74be1bb7ee51a891e6`. Follow-up guard correction
`041e4320bc47c614f52aa2fd5f0209da23418e3e` advances the migration success allowlist to the current
owners and makes the workload/restore inspector preserve nullable Terraform inputs correctly. Both
commits are on shared `main`; no agent branch or unmerged work remains from this packet.

## Immutable publication

- Workflow receipt SHA-256:
  `5559719772ee6a5eff41f4ed947c1728dcd250d5cee0b1defd2465e353d96ab5`.
- Public-job receipt SHA-256:
  `41baa0e26788eee104f1bacca5b1f243cfb2fa708f97c285a5873ea9f67dfd5d`.
- Gateway receipt SHA-256:
  `4cd2a8351cc09bf474aca599171682ace58096bad196457c3ba1c0e37282143f`.
- Migration-image receipt SHA-256:
  `c4f0236b45109a75ca5ed9c73c7a07d020ed290f89ff71bf58433a5556c5d2b9`.
- Linux/AMD64 migration image digest:
  `sha256:f2ce6dfe64b219ebc9a97c12b1dc7d956a14d55141bb93827e3fce3131fe4873`.
- The image built twice deterministically, passed the hardened runtime smoke and immutable readback,
  and completed scanning with zero Critical and zero High findings.

No publication action deployed code, enabled a trigger, added a route, or started a workflow.

## Default-dark application release

Saved application plan SHA-256
`810723d41693f77e3fc93c01f25c154c0a2286352f79b7afc535ad598d2fe089` changed only the exact
allowlisted Lambda/version/policy chain and its policy-propagation sentinel: one add, nineteen
in-place changes, and one removal of the superseded sentinel. Candidate rights, public routes,
indexing, ingestion runtime/source/provider/private-egress, and document event sources remained
false. The migration task definition was deliberately unchanged in this first apply.

All current application aliases are numeric and unweighted. Gateway is version `38`; outbox
reconciler/starter and profile readiness activity/terminal/durable are version `7`; public-job edge
and projection are version `6`. Every function is `Active` with `LastUpdateStatus=Successful`.

## Migration and live boundary

Saved migration-task plan SHA-256
`fffd9fa5b04ad65136259b2c62a912a7c1ee2b3ced4dd8b201fe33ada3a395d0` replaced only
`module.platform.aws_ecs_task_definition.migration[0]`, producing revision `44` with the exact
verified digest and no command, environment, CPU, memory, role, or resource override.

Exactly one task, ending in `9b6b083ccd2d4277a0ab563ec305b512`, stopped with exit code `0`.
Its six aggregate-only messages appeared exactly once and verified five owners and all 26 current
migrations through Profile `0006_candidate_rights`, Jobs `0013_public_job_sitemap`, Documents
`0003_candidate_rights`, Matching `0002_candidate_rights`, and Billing `0002_candidate_rights`.
The composed restore boundary is nine schemas and 45 relations. The cluster returned to zero tasks
and zero services.

The live boundary passes the repository's 24-case gateway verifier. Liveness/readiness are
`200/200`; an unauthenticated protected request is `401`. Because the public routes remain absent,
both public job detail and sitemap fall through the JWT-protected default route and return `401`.
All 44 managed alarms are `OK`, all eight queues are empty, document event sources are disabled,
ingestion has zero configured provider sources, and ECS is idle.

The final state lineage remains `472ef790-b249-45ec-817f-718005980d9e` at serial `202`. Saved
refresh-backed plan SHA-256
`dc193a5ac8b46672ff2594496227356088c78ea592e34d91803809841a03ac41` has zero meaningful
resource or output changes.

## Current-schema recovery

The guarded recovery preflight initially failed closed on two stale inspector assumptions: missing
candidate-rights input names and empty environment variables for nullable numbers. No restore target
or verifier task existed during either failure. Commit
`041e4320bc47c614f52aa2fd5f0209da23418e3e` adds the exact input set, removes null variables from the
process environment, and updates both PowerShell-host regressions.

The corrected preflight then passed with the source private, encrypted, deletion-protected,
available, covered by seven days of PITR, all 44 alarms `OK`, ECS idle, and no prior target or
context. One isolated latest-point-in-time copy became available in 2,124 seconds. Source and target
both reported manifest
`d1-public-sitemap-profile-jobs-documents-matching-billing-v1`, SHA-256
`ecfd23e61bc7d1beaa27e3758b45a31dc0a36fedfb3a58a0142b2b7f55d2913e`, five owners, 45
relations, and 26 migration entries. The aggregate digest matched; the target verifier emitted one
event with zero forbidden log matches. Functional recovery completed in 2,224 seconds.

Cleanup deleted the exact target and its automated backups. Zero restore targets, snapshots, target
backups, running ECS tasks, and local restore contexts remain. The source is available, all 44
alarms are `OK`, and Terraform remains zero drift. This is bounded development recovery evidence,
not a production RTO/RPO, row-value-integrity, or capacity commitment.

## Verification

- Ingestion unit tests: 77/77 plus typecheck.
- Migration operator tests: PowerShell 7 and Windows PowerShell 5.1 pass.
- Restore verifier/inspector tests: PowerShell 7 and Windows PowerShell 5.1 pass.
- Full `infrastructure:validate` passes, including gateway, publication, candidate-rights,
  representative-assurance, migration, restore, and PostgreSQL catalog-invariant guards.
- Scoped Biome and `git diff --check` pass. Biome reports two pre-existing warning-only literal
  Terraform placeholder strings in the infrastructure validator.

## Remaining gates

No further backend publication, migration, or development recovery mutation is presently required
for this candidate. Phase 1 remains open for Vercel project/login/hosted browser and response-header
acceptance; human assistive-technology testing; accountable product, source-quality, moderation,
security/privacy, ADR-023, candidate-rights deployed lifecycle/replay, representative SLO,
alert-recipient, and safe provider-fault-fixture decisions. Until those gates are supplied, public
routing/indexing, provider schedules, document triggers, candidate-rights execution, admin authority,
and real-candidate data remain disabled.
