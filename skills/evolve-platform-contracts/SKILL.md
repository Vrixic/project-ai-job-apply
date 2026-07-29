---
name: evolve-platform-contracts
description: Safely evolve the platform's OpenAPI endpoints, generated types, CloudEvents schemas, domain JSON Schemas, application-field taxonomy, PostgreSQL ownership, and explicit SQL migrations. Use for adding or changing API fields or routes, events, entities, persisted columns, answer policies, schema versions, compatibility rules, or generated contract artifacts.
---

# Evolve Platform Contracts

## Locate the source of truth

- REST API: `../../packages/api-contracts/openapi/platform.v1.json`
- Generated API types: `../../packages/api-contracts/generated/`—never hand-edit
- Runtime validation: `../../packages/api-contracts/src/`
- Domain schemas: `../../packages/domain/schemas/v1/`
- Event schemas: `../../packages/event-contracts/schemas/`
- Application fields: `../../data/taxonomies/application-fields.v1.json`
- Profile persistence: `../../backend/services/profile/src/` and `migrations/`

Read the ownership registry, package READMEs, ADR-003, ADR-004, and ADR-006 before changing a
shared or persisted shape.

## Design compatibility first

1. Identify producers, consumers, data owner, classification, and retention.
2. Prefer additive optional changes within an existing version.
3. Introduce a new version for removals, semantic changes, incompatible required fields, or
   meaning changes.
4. Keep strict objects explicit; do not weaken validation to pass unknown fields.
5. Make consumers tolerate the supported old and new versions during rollout.
6. Put only identifiers and essential operational metadata in events; never include unrestricted
   resumes, tokens, page bodies, or sensitive form values.
7. Keep transport shapes separate from persistence models.
8. Add explicit forward-only SQL for persisted changes. Do not rely on runtime schema mutation.
9. Define backfill, rollout order, rollback compatibility, and deletion behavior.

For user-visible side effects, include authorization scope, idempotency semantics, operation
status, audit-event behavior, and stable error responses.

## Implement in dependency order

1. Update the authoritative schema.
2. Add valid and invalid examples/tests.
3. Regenerate API types with `pnpm contracts:generate`.
4. Update pure domain logic.
5. Add the migration and persistence mapping.
6. Update producers and consumers.
7. Update client use through generated contracts.
8. Update relevant ADR/security documentation when semantics or data flow changed.

## Validate

Run:

```powershell
pnpm contracts:generate
pnpm --filter @ai-job-apply/api-contracts test
pnpm --filter @ai-job-apply/domain test
pnpm --filter @ai-job-apply/event-contracts test
pnpm typecheck
```

For persistence changes, run the PostgreSQL integration described by
`../operate-local-platform/SKILL.md`. Confirm a second contract-generation pass produces no diff.

## Report

Name the affected contract version, compatibility assessment, migration/rollout order, consumers,
data classification, and executed evidence. Do not call a schema compatible merely because it
compiles.
