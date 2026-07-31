# Staging Application Rollout

Use this procedure to enable the lean gateway and workflow worker in the dedicated staging AWS
account in `us-east-2`. This staging run is controlled engineering acceptance with synthetic
identities and product data only.

Under [ADR-014](../../../docs/adr/014-shared-development-auth0-for-synthetic-staging.md), staging
may temporarily trust the exact development Auth0 issuer. This does not prove identity-provider
isolation and does not authorize real candidates, invited testers, public access, live ATS
submissions, or a release-candidate claim.

## Preconditions

- Authenticate through `ai-job-apply-staging-admin`; prove the staging and development callers
  resolve to different AWS accounts without recording either identifier.
- Require Terraform `1.9.8`, the exact KMS-encrypted staging `platform.tfstate`, and a
  refresh-backed applications-disabled no-drift plan.
- Require the controlled staging database migration to have completed successfully.
- Require immutable `linux/amd64` gateway and worker platform digests in the isolated staging ECR
  repositories. Require `COMPLETE` scans with zero critical, high, medium, and low findings.
- Reverify the exact temporary Auth0 issuer through public discovery/JWKS, RS256, and the stable
  `ai-job-apply-api` audience. Do not configure a test-token bypass or arbitrary issuer.
- Reverify the isolated staging Temporal endpoint/Namespace ID through exactly one `AWSCURRENT`
  value in `ai-job-apply/staging/temporal-api-key`.
- Keep provider keys, database values, tokens, account IDs, repository URLs, Terraform plans, raw
  task definitions, and environment suffixes out of source control and shared evidence.

Stop before planning if any prerequisite fails. The development Auth0 issuer is the only shared
provider boundary; AWS state/data and the Temporal namespace/key remain staging-specific.

## Review the enablement plan

Resolve repository URLs from staging Terraform output and append only approved platform-manifest
digests. Supply Auth0 and Temporal values through process-scoped Terraform variables; never write
them to a committed variable file.

Save a refresh-backed plan and inspect its JSON without printing sensitive values. The current
first staging enablement may contain only:

- five API Gateway resources: HTTP API, VPC Link, default integration, route, and stage;
- two Cloud Map resources: private namespace and gateway `SRV` service;
- one immutable gateway task definition and one lean ECS service;
- one immutable worker task definition and one lean ECS service;
- one bounded application tracing policy;
- two heartbeat metric filters and two missing-signal alarms; and
- one in-place update to the existing operations dashboard that adds only API Gateway and
  application-heartbeat visibility.

The allowlist is 16 creates, one dashboard update, zero replacements, and zero deletes. Reject any
other update; any persistent-data, network, KMS, secret-container, queue, registry, database,
migration, or state action; any mutable or unapproved image/provider value; desired counts other
than one; or any Redis, NAT, ALB, Multi-AZ, private-application-networking, or enhanced-insights
activation.

Record the saved-plan SHA-256 and apply only that exact artifact after explicit authorization. A
Terraform plan file can contain sensitive state values: keep it local, never commit it, and remove
it after the apply result and hash are recorded.

## Verify the live rollout

Require all of the following:

1. The exact saved plan applies successfully, and a refresh-backed plan with identical inputs
   reports no changes.
2. Gateway and worker services are `ACTIVE`, each at desired `1`, running `1`, pending `0`, with a
   completed primary deployment.
3. Running containers use the approved gateway and worker platform digests; each tracing sidecar
   uses the reviewed immutable collector digest.
4. Cloud Map reports a healthy gateway registration with IPv4 and port attributes.
5. The regional API endpoint returns `200` for `/health/live` and `/health/ready`; readiness proves
   PostgreSQL connectivity.
6. A protected endpoint without a token returns `401` without provider/token detail.
7. Encrypted logs contain sanitized gateway/worker startup and heartbeat events; the worker
   connects to the isolated staging Temporal namespace; collectors report no exporter failure.
8. A controlled synthetic authenticated transaction completes persistence, outbox dispatch,
   Temporal workflow, and durable operation result.
9. Two synthetic Auth0 accounts prove owner isolation: the second account cannot read the first
   account's operation, and neither identity/resource identifier enters evidence.
10. The dashboard, heartbeat metrics/alarms, X-Ray trace, operational alarms, and SNS routing are
    present. Controlled ALARM/OK notification drills require an explicitly confirmed subscriber.
11. Inspected logs/traces contain zero database URL, API key, token, email, preference, raw
    identity, operation/workflow identifier, or other forbidden-field patterns.

This proves only synthetic staging application acceptance. It does not close the ADR-014 launch
gate or provide independent Auth0 tenant failure isolation.

## Failed or completed staging run

If enablement partially fails—or after the on-demand acceptance window—create a saved rollback
plan with `deploy_applications=false` and the approved migration image retained. Review the exact
reverse boundary:

- delete only the 16 application resources created above;
- update only the operations dashboard to remove API/heartbeat-only presentation; and
- preserve the migration task definition and every persistent resource.

Apply only the exact reviewed rollback plan. Require zero ECS services/tasks, platform API Gateway
APIs, and Cloud Map namespaces; retain the isolated Temporal secret; require an
applications-disabled refresh-backed no-drift plan; and record only sanitized aggregate evidence.

Do not destroy RDS, KMS, S3, SQS/DLQ, ECR, secrets, networking, state, or migration history as an
application rollback. If acceptance is continuing, keep the lean one-task services; if the
on-demand exercise is complete, return staging to the applications-disabled posture unless a
recorded launch/recovery need justifies continued operation.

Use the reviewed
[staging application recovery procedure](staging-application-recovery.md) for the Phase 0
controlled restart and full application-only disable/reenable drill. It separates plan creation
from checksum-authorized apply and preserves ignored reconstruction inputs until the exact reverse
plan has restored the enabled no-drift baseline.
