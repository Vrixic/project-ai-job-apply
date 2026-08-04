# Staging Serverless Workflow Release Rollback

Use the shared [serverless workflow release-rollback runbook](serverless-workflow-release-rollback.md)
through `operate-staging-serverless-workflow-release-rollback.ps1`. The wrapper fixes the
environment to `staging` and defaults to the isolated staging IAM Identity Center profile.

Before the first staging drill, publish, deploy, conform, and accept a second behavior-neutral
workflow release. Retain its reviewed release plan plus the accepted initial staging release plan
below the staging `.terraform` directory. Never select a failed, unconfirmed, cross-environment,
or development artifact set as either endpoint.

Rollback and restoration are separate AWS changes. Generate each plan from exact clean merged
`main`, independently inspect its action boundary, and obtain explicit authorization of each
printed SHA-256. Repeat staging dark conformance and confirm all four notifications after both the
rollback and the restoration before cleanup.
