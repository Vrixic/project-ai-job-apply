# Development Environment

The D1 ingestion data plane uses the ordered gates
`deploy_ingestion_runtime`, `ingestion_runtime_enabled`, and
`ingestion_synthetic_source_enabled`. All three default false and must advance in the listed order.
Supplying immutable ingestion artifacts therefore does not
create or activate a schedule, queue consumer, source, or provider;
the shared `runtime_activation_allowed` authority also gates any trigger activation.
Bounded Greenhouse, Lever, and Ashby sources have separate
`ingestion_provider_activation_allowed` authority and an exact structured
`ingestion_provider_sources` list. They default false/empty and cannot activate without the shared
runtime authority, an enabled exact source, and private NAT egress.

Composes the lean serverless platform in the dedicated development AWS account in `us-east-2`.
The exact Auth0 issuer must include its trailing slash; the stable API audience is
`ai-job-apply-api`.

Keep `high_availability = false`, `private_application_networking = false`, and
`enable_redis = false` until measured reliability, security, or launch evidence requires a change.
The account-local $5 budget is an alerting reference, not a spending cap.

Lambda artifacts are immutable, versioned S3 objects. The only container artifact is the scanned
immutable database-migration image in `ai-job-apply/migration`. Applications can be bootstrapped
dark; `serverless_runtime_enabled` controls the public API routes and all workflow triggers as one
fail-closed boundary.

Use Terraform saved plans and exact checksums for artifact releases, migrations, runtime
disable/enable, restore, and infrastructure changes. Never reconstruct the removed continuous ECS
or external workflow-provider runtime from historical evidence or console changes.

Phase 2 development contributions can explicitly opt into
`d2_community_runtime.development_contributions_enabled = true`. With the existing runtime
deploy/activation inputs enabled, this removes expiring signed contribution-policy configuration
from Gateway and the scheduled processor. `signed_policy_json` and `signed_public_keys_json`
may be omitted, and `policy_endpoint_enabled` may remain false. The development marker and
enable flag are injected together; production-mode Node.js execution is unchanged.

This flag defaults false and changes no provider registry, verification, identity scope, Trust
role, queue, schedule, concurrency, or alarm setting. It cannot activate an otherwise disabled
runtime. The shared platform module rejects this flag outside development; this is not a
production or browser-store release configuration.

The optional `d2_community_runtime.development_contribution_providers` list selects unique
`greenhouse`, `lever`, and/or `ashby` names only in that explicit development mode. Omission
preserves Greenhouse-only behavior without a new environment key; `[]` denies every provider.
It does not change enable flags or create verification registrations, and additional providers
remain subject to their separate source, fixture acceptance, and activation configuration.
