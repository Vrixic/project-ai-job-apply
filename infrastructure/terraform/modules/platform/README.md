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

`d2_community_runtime.maintenance_mode` defaults false. Setting it true pauses an already
activated D2 contribution/review boundary without changing activation inputs or destroying
resources. The existing scheduled rule and Trust-signal mapping are disabled in place, both D2
worker reservations become zero, and their existing `D2_COMMUNITY_RUNTIME_ENABLED` setting is
false. Gateway contribution and reviewer route flags become false, while the exact API routes,
queues, aliases, permissions, alarms, provider-only network, provider registrations, reviewer
assignments, policy inputs, and immutable artifact coordinates remain configured. The reviewed
nonzero concurrency inputs and mapping maximum remain validated and retained for resumption.
Maintenance neither grants authority nor bypasses any existing activation validation.

Unrelated D1 functionality and the independently owner-scoped private-capture routes remain
available. Private captures use Matching persistence and Profile account status; Jobs `0023`
and Trust `0004` change neither path. The optional read-only signed-policy endpoint also remains
unchanged. Existing handlers deny disabled contribution/reviewer routes before application
dispatch, and disabled worker configuration performs no database, queue, or provider setup.

Terraform changes are not atomic and zero concurrency does not terminate work already running.
Before a migration, independently verify the deployed Gateway/worker flags, zero D2 reservations,
disabled schedule/mapping, completed prior invocations and the bounded queue/in-flight drain
conditions in the release runbook. A timeout alone is not proof that retained asynchronous work
has retired. Keep pending jobs and signals intact; do not purge or reassign them. Resume only after
the coordinated schema and compatible immutable Gateway/worker artifacts are verified, by
reviewing a new plan with `maintenance_mode = false`. This restores the configured execution
limits and triggers, not a second set of resources or a historical binary rollback.

Development can explicitly set `d2_community_runtime.development_contributions_enabled = true`
to remove the signed contribution-policy renewal dependency. This optional flag defaults false
and is rejected unless `environment = "development"`. It does not activate the runtime on its
own. When the existing deployment and activation gates are enabled, only Gateway and the
scheduled contribution processor receive `D2_DEPLOYMENT_ENVIRONMENT=development` and
`D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED=true`; signed policy and public-key environment values
are omitted even if legacy input values remain. Signature inputs may be omitted or empty, and
the legacy anonymous policy route is optional in this mode. A retained route does not reinstate
the signature requirement. Dark policy-only deployments still require signed configuration.

The development mode does not change managed OIDC/scopes, selected provider registries,
independent verification, Trust assignments/evidence, worker limits, alarms, role separation,
or production/store release boundaries. Configuration remains bounded to 2,400 encoded bytes.
Staging, production, and default development behavior retain signed-policy verification.

`development_contribution_providers` is an optional list of unique exact `greenhouse`, `lever`,
and `ashby` names, defaulting to `["greenhouse"]` for backward compatibility. An explicit `[]`
denies all development providers. Every non-default selection requires the development
environment and the explicit development-contribution flag; it does not enable the deployment,
runtime, provider fetches, or registrations by itself. Only an already enabled development
Gateway and scheduled processor receive `D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON`, identically
encoded. The default Greenhouse-only selection omits this new environment key, preserving the
existing runtime environment shape. The Trust-signal runtime never receives it. Additional
provider activation still requires the corresponding reviewed source and independent-verification
registrations; contribution selection alone does not establish provider or publication readiness.

`development_contribution_domains` is an optional additional host restriction. Omission or `null`
preserves the existing environment shape and applies no extra restriction; `[]` denies every host.
A non-null list must contain at most five unique exact supported provider hosts and requires
explicit development contribution mode. Only Gateway and the scheduled processor receive
`D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON`; the Trust-signal runtime is unchanged. The restriction
is intersected with the selected provider and its immutable descriptor, not a replacement for
either. In particular, global Lever can be selected while `jobs.eu.lever.co` remains denied.
This neither activates providers nor establishes representative-fixture or publication acceptance.
Matching exact source/verification registrations and the extension's separate detector-domain
policy remain required. The added JSON counts toward the existing 2,400-byte encoded configuration
budget, and maintenance retains the restriction while pausing execution.

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
