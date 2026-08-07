# Development Environment

Composes the continuously available lean platform in the dedicated development AWS account in
`us-east-2`. Copy the example variables outside source control, provide reviewed values, and keep
`deploy_applications = false` until immutable images, the isolated development Auth0 tenant, and
Temporal Cloud are configured.
The Auth0 issuer must be copied exactly, including its trailing slash; the stable API audience is
`ai-job-apply-api`.

Keep replicas at one, `high_availability = false`, `private_application_networking = false`, and
`enable_redis = false` until recorded load, reliability, security, or launch evidence requires a
change.

The zero-traffic pre-cutover posture defaults `run_continuous_ecs_runtime = false`. Apply it only
through the [Phase 0 ECS idle-shutdown runbook](../../../runbooks/deployments/phase0-ecs-idle-shutdown.md),
which retains both ECS services and their rollback artifacts at zero desired tasks. The current ECS
API and Temporal path are intentionally unavailable while idle; do not interpret that expected
state as authority to restart tasks or delete the retained rollback boundary.

The account-local cost controls use a $5 monthly reference budget with one actual-cost alert at
$5, plus a resource-attributed CUR 2.0 export retained for 400 days. Alerts do not cap spend.

Follow the [development cloud setup checklist](SETUP.md) before bootstrap or deployment.
Use the [development database migration runbook](../../../runbooks/deployments/development-database-migration.md)
to provision and execute the migration task while applications remain disabled.

For the scale-to-zero migration, configure the GitHub `development` Environment variable
`ARTIFACT_BUCKET` from the nonsensitive Terraform `artifact_bucket` output. Publishing the gateway
Lambda artifact does not deploy it. Keep `deploy_gateway_lambda = false` until the source commit,
artifact/SBOM evidence, exact S3 version/digests, extension layer, provider-upgrade plan, and dark
deployment plan are independently reviewed.

Keep `deploy_profile_readiness_durable = false`, `deploy_serverless_outbox = false`, and
`serverless_runtime_cutover = false` until SR-003/SR-004 source evidence, all three exact published
workflow artifacts, the pinned regional Secrets extension, bootstrap permission changes, and a
refresh-backed no-route-change plan receive separate review. Initial dark deployment creates the
replacement functions and alarms but leaves the API Lambda integration, SQS event-source mapping,
reconciler schedule, and terminal-event rule disabled. The one cutover switch later moves API
routing, new-event dispatch, and all replacement triggers together.

The rollback-only `retain_gateway_lambda_integration_during_rollback` input defaults to `false`.
When development cutover is eventually exercised, it may be enabled only for an ordered rollback
transition that first moves the API route and disables dispatch/triggers. A separate verified plan
must remove the resulting unreferenced integration; never combine those operations in one apply.
Use the [development serverless runtime cutover runbook](../../../runbooks/deployments/development-serverless-runtime-cutover.md)
for the exact planning, checksum authorization, acceptance, rollback, and restoration sequence.
