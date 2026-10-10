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

`d2_community_runtime.development_contribution_domains` optionally narrows those providers to an
exact unique subset of the five supported job-page hosts. Omission or `null` emits no additional
environment key; `[]` denies all hosts. Any non-null list requires explicit development contribution
mode and reaches only Gateway and scheduled processing. For global-only Lever, omit
`jobs.eu.lever.co` from the reviewed list while retaining the accepted Greenhouse hosts and any
separately accepted hosted Ashby host. Provider registration and extension detector activation
remain independent; this setting changes no immutable descriptor, migration, identity, or Trust
authority.


## Native download DNS

`native_material_dns_enabled` defaults false. Enabling it creates only the public Route 53 zone
`materials.dev.applydash.ai`. The `native_material_dns` output supplies the exact zone ID and four
nameservers. In Cloudflare's `applydash.ai` DNS records, add four NS records named `materials.dev`,
one for each output nameserver. Keep the parent domain's Cloudflare nameservers unchanged.
The dedicated zone is protected against Terraform destruction and nonempty forced deletion.

The runtime creates allocation-specific records below this base host through its existing scoped
Route 53 permissions. Zone creation/delegation does not enable runtime routes or launch tasks.
A browser-trusted certificate covering `*.materials.dev.applydash.ai`, its pinned managed-secret
version, immutable task/function bindings and verified runtime release remain required. A Cloudflare
Origin CA certificate alone is insufficient for the direct browser-to-task HTTPS connection.
Retain `native_material_dns_enabled=true` in subsequent complete deployment input baselines after
creation; omitting it proposes removal and is refused by the resource's destruction protection.


`native_material_tls_managed` independently opts in to metadata ownership for the development
`native-material/tls` and `native-material/acme-account` Secrets Manager entries. Existing entries
must be adopted with `native_material_tls_imports` mapping `tls` and `acme-account` to their exact
ARNs. Review the saved import plan before applying. Only metadata is modeled: no secret-version
resource or secret-value data source belongs in this configuration. Both entries use the platform
KMS key, a 30-day recovery window and destruction protection. This does not grant a task access,
rotate a certificate or enable runtime traffic. Retain this flag in future full input baselines.

Certificate renewal is a separate operation. An original release pins a TLS secret version; updating
AWSCURRENT alone does not update existing image configurations. Before expiry, renew using the
retained ACME account, verify the wildcard/chain/key, stage the new immutable secret version, and
build/deploy new original releases while retaining old releases until their work is drained.
The current one-off issuance receipt does not establish automated renewal or expiry alerting.

Development exposes the default-null `application_restore_reconciliation` input and its separate
task-definition output. See the [platform diagnostic boundary](../../modules/platform/README.md#read-only-applications-restore-reconciliation).
It admits only a dormant primary, retained legacy-receipt key and disabled paid endpoints/replay/
transition authority. Pass a separately verified immutable diagnostic image without changing the
ordinary migration image. Registration grants no restore or task-launch authority. Keep it null in
ordinary full input baselines; enable only for the reviewed short diagnostic window and return it
to null after the original task is terminal. Snapshot/data/privacy and live acceptance stay separate.