# D2 local provider-truth migration and recovery evidence — 2026-09-02

## Scope

This repository-local, generated-synthetic exercise refreshes the migration-image and recovery
boundary after Jobs migration `0019_job_contribution_provider_publication` at source commit
`18c41bf`. It is not an AWS deployment, image publication, vulnerability scan, RDS point-in-time
restore, or production recovery claim.

## Exact boundary

- Restore manifest: `d2-provider-truth-profile-jobs-documents-matching-billing-trust-v1`
- Manifest SHA-256: `86e6e1f1cd17ba92862c6ee5ea7ada9a83a0f2367758e74447fe519e6ed7c119`
- Owners: 6
- Owned schemas: 10
- Regular relations: 68
- Checksum-bound migrations: 39
- Jobs 0019 SHA-256: `4da15bc6cdb347c65ff71c71b266b3d857962bb91e3dc4bc970a45a09dbe9fae`

The image inventories and smoke gates require Jobs 0019 explicitly. The restore integration guard
also requires the source and restored databases to retain all four nullable `job_id`/`source_id`
catalog columns, all four catalog foreign keys, and the required non-null JSONB provider-observation
column.

## Local verification

A named disposable PostgreSQL `16.6-alpine` instance received the six owner migration runners in
the production order: Profile, Jobs, Documents, Matching, Billing, and Trust. The source database
was exported with `pg_dump` custom format and restored with `pg_restore --exit-on-error` into a
distinct database in the same isolated instance.

The read-only repeatable-read verifier returned exact equality for source and restored databases:

- Aggregate digest: `9132cb206675ba5e5c1c1396c55254352818fa21735876935997b44f201072ba`
- Owner count: 6 / 6
- Relation count: 68 / 68
- Migration count: 39 / 39
- Nullable catalog columns: 4 / 4
- Catalog foreign keys: 4 / 4
- Required provider-observation columns: 1 / 1

Repository guards also passed:

- Database-migrations unit tests: 35 / 35
- Development migration-image publisher PowerShell guards
- Staging PostgreSQL restore-verifier PowerShell guards
- Database-migrations TypeScript build

The named disposable database container was stopped and removed after verification. The shared
development Docker stack and its volumes were not changed.
