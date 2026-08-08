# Development Environment

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

Use the provider-retirement runbook while the historical Temporal secret and gateway/worker ECR
repositories still exist. After retirement, use Terraform saved plans and exact checksums for
artifact releases, migrations, runtime disable/enable, restore, and infrastructure changes. Never
restore the removed ECS/Temporal runtime from historical scripts or console changes.
