# Staging Environment

Composes the same lean serverless platform in a separate AWS account and non-overlapping
`us-east-2` network. Use it for release candidates, migration rehearsals, restore exercises,
security acceptance, and launch preparation—not as continuously provisioned duplicate compute.

Controlled synthetic-only staging may temporarily trust the development Auth0 issuer under
[ADR-014](../../../../docs/adr/014-shared-development-auth0-for-synthetic-staging.md). That does
not prove identity isolation and permits no real users, invited testers, live ATS submissions, or
launch claim. Dedicated staging and production tenants plus repeated conformance remain mandatory
before launch.

The account-local $5 budget is an alerting reference, not a spending cap. Lambda artifacts are
immutable versioned S3 objects; the only application container is the scanned migration image.
`staging_runtime_mode` defaults to `dormant`. Dormant removes the disposable synthetic RDS instance
and three hourly interface endpoints while retaining encrypted state, artifacts, identity, queues,
logs, cost controls, and dark serverless definitions. `active -> quiesced -> dormant` is the only
permitted shutdown path; activation recreates a dark data plane before migration and synthetic
seeding. See [ADR-018](../../../../docs/adr/018-disposable-prelaunch-staging-data-plane.md) and the
[lifecycle runbook](../../../runbooks/deployments/staging-runtime-lifecycle.md).

`serverless_runtime_enabled` controls the JWT API route and all durable-workflow triggers together
and may be true only when `staging_runtime_mode = "active"`.

Use saved checksum-reviewed Terraform plans for every release, migration, runtime disable/enable,
restore, or infrastructure change. There is no continuously running ECS or external
workflow-provider fallback.
