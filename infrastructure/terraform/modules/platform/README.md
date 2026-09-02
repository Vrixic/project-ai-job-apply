# Platform Module

Creates the lean AWS platform: VPC/subnets, encrypted RDS, S3 artifacts, SQS/DLQs, KMS, API
Gateway, Lambda request handling, Lambda durable workflows, alarms, budgets integration points,
and a one-off ECS/Fargate database-migration capability.

The request and workflow runtime is serverless. `deploy_gateway_lambda`,
`deploy_serverless_outbox`, and `deploy_profile_readiness_durable` allow immutable artifacts to be
deployed dark. `serverless_runtime_enabled` is the steady-state route/trigger kill switch: when
false, the Lambda integration remains deployable but no public route or workflow trigger is active;
when true, the JWT-protected default route, two public health routes, SQS starter, reconciler
schedule, and terminal-recovery rule activate together. There is no ECS or Temporal fallback.

Phase 2 community composition uses one independent `d2_community_runtime` deploy/activation
boundary. Its all-empty default creates no D2 function, queue, schedule, mapping, route, or NAT.
`deploy = true` requires exact immutable artifact identities, bounded Lambda concurrency/timeout,
queue retention/redrive values, alarm thresholds, the persistent data plane, and the reviewed
Secrets extension. It can create two versioned aliases, the dedicated encrypted Trust-signal
queue/DLQ, split least-privilege roles, and Lambda/queue alarms while all schedules, mappings, and
routes remain structurally absent.

`enabled = true` is a separate activation and additionally requires an explicit schedule; the
processing, contribution-delivery, and Trust-delivery worker, batch, lease, and retry policies; a
complete signed contribution policy/key pair; complete Trust reviewer/evidence/policy inputs;
route rate/burst budgets; runtime activation authority; and an accountable release-authority
token. Activation creates only exact routes: anonymous policy GET uses `NONE`, private capture
uses existing read/write scopes, candidate contribution/consent/owner Trust uses
`jobs:contribute`, and reviewer Trust uses its exact role scopes. D2 scopes are never added to the
generic `$default` route. No provider host, credential, NAT, egress rule, policy content, reviewer,
appeal timing, or activation value is supplied by module defaults.

The gateway and reconciler are the only producers for the platform-CMK-encrypted outbox queue.
The durable orchestrator is outside the VPC and invokes an exact activity version; database
activity and terminal handlers remain private and retrieve only the database secret. A narrow
Terraform-owned CloudFormation stack is retained because the AWS provider does not expose the
durable function's checkpoint KMS input.

`aws_ecr_repository.migration` is the only application container repository. It is immutable,
scan-on-push, and KMS encrypted. A nonempty `migration_image` creates a one-off Fargate task
definition and must reference an exact digest in that repository. The task has no listener, uses
the existing application security group, retrieves only `DATABASE_URL`, and exits after applying
and verifying versioned PostgreSQL migrations. With public IP assignment disabled, exact-role
private endpoints provide ECR API/registry access, the regional ECR layer-bucket S3 path, Secrets
Manager, and CloudWatch Logs without adding NAT or general internet egress. The ECS cluster itself
has no continuously running service.

The lean defaults keep PostgreSQL Single-AZ, Redis absent, and NAT absent until measured or launch
evidence justifies expansion. Lambda concurrency and database-handler concurrency remain bounded
to protect the small database. Logs, native traces, queue age, DLQs, Lambda errors/throttles, RDS
capacity, and notification delivery remain visible through encrypted CloudWatch/SNS resources.

The retired gateway/worker ECS services, task definitions, Cloud Map, VPC Link, container
heartbeat alarms, gateway/worker ECR repositories, Temporal secret, and application task role are
not part of this module. Historical cutover evidence remains in delivery records and ADRs; it is
not an executable recovery path.
`persistent_data_plane_enabled` separates the hourly private database/endpoint data plane from the
retained serverless control plane. It defaults on for normal environments. A caller may disable it
only after traffic is quiesced and database deletion protection has been removed by a separate
reviewed apply. This generic switch is currently owned by synthetic staging under ADR-018; it is not
a production retention policy.

The optional D1 source-neutral ingestion composition is separately deployable and remains dark by
default: `deploy_ingestion_runtime`, `ingestion_runtime_enabled`, and the selected source enable
flags must be advanced deliberately, and the shared `runtime_activation_allowed` lifecycle
authority must permit trigger activation. Greenhouse, Lever, and Ashby use a bounded structured
`ingestion_provider_sources` list. Enabling any provider also requires
`ingestion_provider_activation_allowed=true` and `ingestion_provider_private_egress=true`. The
latter temporarily creates NAT routes in the already deployed provider-only private subnets and
moves only the ingestion runtime provider-fetch activity onto them. The free subnets and their
route tables remain after restoration with no default route so retained immutable Lambda versions
do not block cleanup or lose their exact network boundary. The coordinator, starter, terminal
handler, and shared private application subnets retain no default internet route.
Configuration supplies no arbitrary endpoint or credential. Each source is independently
default-off and remains subject to its exact persisted pause tuple. Its work queue
retains identifier-only nudges for four days. Its shared DLQ retains only value-free schedule,
terminal-metadata, durable-identifier, and nudge-failure envelopes for fourteen days and has no
automatic consumer or redrive. No
real-provider configuration, event-source mapping, schedule, or source is enabled by repository
defaults.

`deploy_public_job_reader` can dark-provision an immutable anonymous edge and a separate private
projection Lambda, each with reserved concurrency one. The edge has no VPC attachment, database
identity, RDS-IAM grant, database secret, or KMS-decrypt code path. It may invoke only the exact
qualified projection alias with an identifier-only request. Only the projection enters the VPC and
may connect as `ai_job_apply_public_job_reader`; its sole application read is the fixed
security-definer detail function from Jobs migration `0006_public_job_reader` or the bounded
sitemap function from migration `0013_public_job_sitemap`. This contains the
cluster-global PostgreSQL residuals behind a non-public fixed-query service boundary instead of
placing them in the anonymous runtime's compromise boundary.

The edge and projection require separate immutable S3 object versions and checksums. The edge
builder fails if its bundle contains the RDS signer, PostgreSQL client, database environment keys,
or public-reader database role marker; those dependencies exist only in the projection artifact.

The route additionally requires the explicit `public_job_route_activation_allowed` release flag,
the global serverless runtime and lifecycle gates, and the persistent data plane. Its rate and burst
remain frozen at one. Edge, projection, and route alarms are mandatory. The deprecated
`public_job_cluster_residual_accepted` input is retained only for state compatibility and has no
activation effect. Artifact publication, reviewed apply, abuse testing, truthful source fields,
indexing approval, and public-surface acceptance remain separate gates; defaults expose no route.

The exact sitemap route is created by the same activation expression as public job detail and is
absent under repository defaults. Its separate route metrics and alarms retain the same frozen
rate/burst and generic availability boundary; adding the source does not enable indexing or
crawling.
