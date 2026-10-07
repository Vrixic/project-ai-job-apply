# D3 resume route release configuration - 2026-10-07

D3-064/D3-079 remain In progress. Local Terraform now composes the previously implemented
route owner/lifecycle flags, original DNS configuration and scoped DNS permissions. No release
values, artifacts, hosted zones or cloud resources were created or activated.

The preparation module and both environments accept an optional `route` with `hosted_zone_id`
and `base_host`. It requires a public-IP task release. `route_enabled` and
`route_creation_enabled` default false; cleanup can continue with creation disabled. Owner and
durable flags agree. Execution timeout is 2,400 seconds, covering the 1,800-second route lifetime
plus bounded startup/propagation/cleanup; encrypted checkpoint retention remains seven days.

Only the original durable role receives DNS permissions: CREATE/DELETE A records with the
allocation-shaped name under the configured host in the exact zone, list that zone, and read
change status. UPSERT is excluded. IAM question-mark patterns constrain name shape, not UUID
hex digits; the strict runtime validates the full original UUID. Zone listing is zone-wide
because AWS provides no record-name condition for that read. GetChange uses the change resource
wildcard because IDs are returned at runtime; application state pins the exact original ID.
See [AWS record conditions](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-permissions.html)
and [action/resource scopes](https://docs.aws.amazon.com/service-authorization/latest/reference/list_route53.html).

Bootstrap accepts the same optional original route on `native_resume_control_releases`, creating
a dedicated durable permissions boundary whose every statement pins the original principal.
The shared workload ceiling is unchanged. Deployment role-create/read statements group the
existing original-role resources and boundaries to stay within IAM's 6,144-character limit;
a swapped boundary cannot grant another role its capabilities because boundaries pin principals.
The first ungrouped implementation failed the size check; the corrected composition passes.
The boundary must be provisioned before environment release, with identical zone/host inputs.
Use a new original release for this configuration; do not retarget unresolved retained work or
assume ordinary deployment permissions can replace an existing role's permissions boundary.

## Verification

Terraform 1.16.2: sixteen preparation-module mocked tests and eight bootstrap mocked tests pass.
They include connected cleanup without creation, original configuration/role/zone restrictions,
invalid activation/public-network combinations, policy limits and unchanged shared permissions.
Development and staging validate successfully. This is synthetic provider evidence, not a live
IAM simulation, refresh-backed plan or managed execution. No full verifier or fresh audit run.

## Remaining work

Private control still needs verified ECS/EC2 network reachability; the non-VPC durable function
can use public Route 53/Lambda endpoints. Hostname/zone ownership, matching task TLS configuration,
ingress, terminal unresolved-work reconciliation, published artifacts and managed download
acceptance remain. The earlier dependency findings remain open. ADR-040 remains Proposed.
D1 and D3 are incomplete. CI/CD deferred; Docker/WSL stayed off and PC stayed on.
