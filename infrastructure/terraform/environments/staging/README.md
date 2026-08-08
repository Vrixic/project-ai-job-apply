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
`serverless_runtime_enabled` controls the JWT API route and all durable-workflow triggers together.

Use the provider-retirement runbook until the historical Temporal secret and gateway/worker ECR
repositories are removed. After retirement, use saved checksum-reviewed Terraform plans for every
release, migration, runtime disable/enable, restore, or infrastructure change. There is no
ECS/Temporal runtime fallback.
