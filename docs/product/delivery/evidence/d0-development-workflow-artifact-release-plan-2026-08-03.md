# D0-016 development workflow artifact-release plan evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Diagnostic Terraform source commit: `bab89bdf404295f2409d90db7b8768680614784a`
- Workflow artifact source commit: `f207bc01d73505244b5e96b8c1005e622953d4f5`
- Terraform version: `1.9.8`
- Diagnostic plan SHA-256: `b49db5eafa8092583cf0e6692d9aa2e46dc0e1444efc1ffa11ad4680c87fe076`
- Status: Guarded refresh-backed diagnostic passed; local sensitive plan is ignored and unapplied

## Release prerequisites

The planner independently revalidated the three exact current-version artifact ZIPs against their
protected publication source, hexadecimal/base64 checksums, object metadata, versioning, and
customer-KMS storage. It also verified the pinned official regional Secrets extension and retained
the effective Lambda unreserved-concurrency pool.

The live dark boundary passed before planning: five immutable development aliases/functions are
active with successful updates and exact bounded concurrency; database-facing functions retain the
pinned extension; the starter mapping and both EventBridge rules are disabled; seven alarms are
enabled and `OK`; the durable DLQ is empty; and the durable stack is complete. API Gateway remains
an HTTP proxy through Cloud Map, both ECS rollback services are stable, and gateway outbox dispatch
remains `temporal`.

## Exact diagnostic result

| Action | Count |
|---|---:|
| Create | 0 |
| Update in place | 14 |
| Delete | 0 |
| Create-before-delete replacement | 1 |

The 14 updates are limited to:

- four Terraform-managed functions selecting the new ingress/activity artifacts and four
  unweighted aliases moving to the versions published by the same plan;
- the durable CloudFormation stack selecting the new durable artifact and exact new activity
  version while retaining immutable durable versions and its development alias;
- the disabled terminal rule's exact durable-version event pattern; and
- four policy documents whose permissions remain tied to the newly computed exact function
  versions.

The single replacement is Terraform's policy-hash-keyed 45-second IAM propagation gate. It is
create-before-delete, retains the same durable role and duration, and changes only its computed
policy hash before the durable stack update. It is not an application or persistent-data resource.

Semantic plan inspection additionally proved that no function configuration changes beyond exact
artifact identity, computed version, and expected release/version references; the terminal rule
remains disabled; retained durable-version controls remain present; no API Gateway action exists;
no ECS action or capacity change exists; no trigger is enabled; and no standalone deletion occurs.

## Validation and authorization boundary

- PowerShell parsing and whitespace validation passed.
- Recovery, release, and completed-dark modes reject mutual use before AWS access.
- The live AWS preflight and refresh-backed action/semantic allowlists passed.
- The sensitive plan remains in an ignored local Terraform directory and was not applied.

This checksum is diagnostic only because the planner source was locally modified on top of the
recorded commit. It must not be used for apply authorization. Merge the operator, runbook, and this
evidence; synchronize exact clean `main`; regenerate the release plan; then obtain explicit
authorization for that new checksum. A successful exact-plan apply must be followed by zero drift,
fresh dark conformance, aggregate log/alarm review, and known-good release rollback before cutover.

No account identifier, bucket/object version, KMS identifier, role/function/queue/service ARN,
credential, token, OIDC value, Temporal value, policy body, state/plan content, raw log, or candidate
data is retained here.
