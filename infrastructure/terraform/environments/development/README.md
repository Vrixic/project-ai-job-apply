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

Follow the [development cloud setup checklist](SETUP.md) before bootstrap or deployment.
Use the [development database migration runbook](../../../runbooks/deployments/development-database-migration.md)
to provision and execute the migration task while applications remain disabled.
