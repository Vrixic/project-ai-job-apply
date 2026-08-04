# Development Serverless Workflow Release Rollback

Use the shared [serverless workflow release-rollback runbook](serverless-workflow-release-rollback.md)
through `operate-development-serverless-workflow-release-rollback.ps1`. The wrapper fixes the
environment to `development` and defaults to the isolated development IAM Identity Center profile.

Development completed the accepted-release rollback/restoration drill on 2026-08-04. Do not
repeat it merely to exercise the shared wrapper; require a new release, recovery need, or material
boundary change and separately review every generated checksum.
