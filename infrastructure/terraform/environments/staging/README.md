# Staging Environment

Composes an on-demand pre-release environment in its own AWS account in `us-east-2`. It uses a
non-overlapping network and the same fail-closed application-deployment gate as development.
Provision it for release candidates, destructive migration rehearsals, restore exercises,
security acceptance, and launch—not as an always-on duplicate throughout every delivery.

The launch boundary uses a staging-only Auth0 tenant and clients and never reuses development or
future production identity configuration. Until launch preparation, controlled synthetic-only
staging may temporarily trust the exact development Auth0 issuer and stable audience under
[ADR-014](../../../../docs/adr/014-shared-development-auth0-for-synthetic-staging.md). This does
not prove identity isolation and permits no real users, invited testers, public access, live ATS
submissions, or release-candidate claim. Dedicated staging and production tenants plus replayed
conformance are mandatory before launch.

The account-local cost controls remain persistent when application tasks are disabled. They use a
$5 monthly reference budget with one actual-cost alert at $5, plus a resource-attributed CUR 2.0
export retained for 400 days. Alerts do not cap spend.

For the scale-to-zero migration, configure the GitHub `staging` Environment variable
`ARTIFACT_BUCKET` from this account's nonsensitive Terraform `artifact_bucket` output. Keep
`deploy_gateway_lambda = false` until the staging artifact and exact provider-upgrade/dark plan are
reviewed. Dark deployment creates no API route or integration and therefore cannot cut staging
traffic away from the accepted ECS rollback path.

The workflow replacement is independently dark by default. Keep
`deploy_profile_readiness_durable`, `deploy_serverless_outbox`, and
`enable_serverless_workflow_triggers` false until the staging copies of all three immutable
artifacts and a refresh-backed plan are reviewed. The first replacement apply may create functions,
private endpoints, alarms, and an encrypted terminal DLQ, but it must not enable any workflow
trigger or change `gateway_outbox_dispatch_target` from `temporal`.
