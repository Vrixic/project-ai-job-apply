# Development Application Rollout

Use this procedure to enable the first long-running gateway and workflow worker in the dedicated
AWS development account in `us-east-2`. The rollout keeps the lean defaults: one task per service,
Single-AZ PostgreSQL, public-subnet task egress, no Redis, no NAT gateway, and no Application Load
Balancer.

## Preconditions

- Authenticate through `ai-job-apply-development-admin` and confirm the caller, account, region,
  remote state, and development ECR repositories align without recording identifiers.
- Require Terraform `1.9.8` and a refresh-backed applications-disabled no-drift plan.
- Require the reviewed database migration to have completed successfully.
- Require immutable `linux/amd64` gateway and worker digests with `COMPLETE` ECR scans and zero
  critical, high, medium, and low findings.
- Reverify the exact managed Auth0 issuer, stable `ai-job-apply-api` audience, public discovery,
  JWKS, authorization-code flow, PKCE S256, and RS256 signing keys.
- Reverify the full Temporal Cloud endpoint/Namespace ID through the KMS-encrypted managed API-key
  secret. Require TLS and exactly one `AWSCURRENT` secret version.
- Keep provider keys, database values, tokens, account IDs, Terraform plans, and raw task
  definitions out of source control and shared evidence.

Do not enable applications with a mutable tag, placeholder provider value, local issuer, local
Temporal endpoint, failed scan, pending migration, or unreviewed Terraform plan.

## Review and apply the enablement plan

Resolve repository URLs from Terraform output and append the approved platform-manifest digests.
Supply the exact Auth0 and Temporal values through process-scoped Terraform variables. Do not write
them to a committed variable file.

Save the plan and inspect its JSON without printing sensitive values. The first enablement plan
must contain only:

- the API Gateway HTTP API, default stage/route/integration, and VPC Link;
- the Cloud Map private namespace and gateway service using an `SRV` record;
- one immutable gateway task definition and ECS service; and
- one immutable worker task definition and ECS service.

Reject persistent-resource changes, replacements, deletions, extra replicas, Redis, NAT, ALB,
Multi-AZ, or unapproved image/provider values. Record the saved-plan SHA-256, then apply only that
exact artifact.

## Verify the live rollout

Require all of the following before calling the rollout successful:

1. Terraform apply completes and a second refresh-backed plan reports no changes with the same
   exact inputs.
2. Both ECS services are `ACTIVE`, each has desired count `1`, running count `1`, pending count
   `0`, and a completed primary deployment.
3. The running containers report the approved gateway and worker image digests.
4. Cloud Map returns a healthy gateway instance containing both IPv4 and port attributes.
5. The regional API Gateway HTTPS endpoint returns `200` from `/health/live` and `/health/ready`;
   the readiness response proves PostgreSQL connectivity.
6. A protected endpoint without a bearer token returns `401` and no provider or token detail.
7. Encrypted CloudWatch streams contain structured gateway-start and worker-start events with no
   database URL, API key, token, email, preferences, or raw identity values.
8. The worker connects to Temporal Cloud and the controlled authenticated vertical slice proves
   owner isolation, persistence, outbox dispatch, workflow completion, and observable operation
   completion.

Record sanitized counts, statuses, digests, HTTP results, and evidence links. Do not copy raw log
payloads or environment identifiers into shared evidence.

## Failed first deployment

If the first apply partially creates application resources, keep persistent resources and the
migration untouched. Create a saved rollback plan with `deploy_applications=false` and the approved
migration image still supplied. Review that it deletes only the partially created API Gateway,
Cloud Map, gateway/worker task definitions, and ECS services. Apply only the exact reviewed
rollback plan, require a no-drift applications-disabled plan, and confirm zero platform ECS
services, API Gateway APIs, and Cloud Map namespaces.

Correct the root cause in reviewed source, rerun repository and Terraform validation, publish and
merge the correction, and generate a new enablement plan. Never reuse a plan produced from older
configuration.

## Bad release after a successful deployment

For an unhealthy new image, prefer an immutable image rollback through a reviewed task-definition
revision. If the entire application boundary must be disabled, use the same application-only
rollback procedure above. Do not destroy or replace RDS, KMS, S3, SQS, secrets, network resources,
the migration journal, or Terraform state as a release rollback.

### Controlled development rollback drill

Run this drill only in the synthetic development environment. Do not use it in staging,
production, or an environment processing real candidate data.

1. Require a refresh-backed no-drift baseline, stable `1/1/0` gateway and worker services, healthy
   gateway/collector checks, healthy Cloud Map registration, and `200` live/readiness responses.
2. Require the gateway rolling configuration to preserve at least `100%` healthy capacity and
   permit at least `200%` maximum capacity. This keeps the current gateway serving while the bad
   revision is evaluated.
3. Resolve the exact currently deployed gateway and worker image indexes. Require both to be
   immutable, contain exactly one `linux/amd64` manifest, and have complete zero-finding ECR scans.
4. Use the already approved worker image as the controlled wrong gateway image. Its immutable
   runtime cannot satisfy the gateway process/health contract, so no new intentionally vulnerable
   artifact or mutable tag is required.
5. Save and inspect the refresh-backed bad-revision plan without printing provider values. Accept
   only one gateway task-definition replacement and one gateway service task-revision update.
   The gateway image and derived release marker may change; the worker, desired counts, collector,
   provider configuration, and every persistent resource must remain unchanged.
6. Apply only that exact reviewed plan. Require at least one controlled revision task to stop or
   fail health while the previous gateway remains healthy and live/readiness continue returning
   `200`. Do not wait for repeated scheduler retries after the failure has been proven.
7. Reconstruct the approved gateway image from the reviewed plan's before-state. Save and inspect
   the rollback plan; require exactly the same two gateway-only actions in reverse.
8. Apply only the exact rollback artifact and require both services to converge to `1/1/0` with
   completed primary deployments, the approved image digests, healthy gateway/collectors, healthy
   Cloud Map, `200` live/readiness, and `401` for an unauthenticated protected request.
9. Inspect controlled-task logs in memory. Record only aggregate event/error counts and require
   zero credential, candidate, email, or JWT pattern matches. Require managed alarms to return to
   `OK`.
10. Run a final refresh-backed plan with the restored exact inputs and require detailed exit code
    `0`. Record plan hashes, action counts, failure class, endpoint continuity, recovery state, and
    no-drift evidence; delete the local plan artifacts.

Stop and restore the approved image immediately if healthy capacity, Cloud Map registration, or
either health endpoint is lost. Never create a drill by weakening the health check, deployment
minimum, alarm, authorization, or secret boundary.
