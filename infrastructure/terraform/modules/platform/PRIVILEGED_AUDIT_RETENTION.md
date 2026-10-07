# Private privileged audit retention release

The platform's optional `privileged_audit_retention_release` deploys the existing Profile-owned
365-day audit expiry Lambda. Null creates no resources. Development and staging forward the
same nullable input; no tfvars enable it. The source SHA, ZIP hash, exact versioned S3 key and
numeric Secrets extension layer must come from a reviewed artifact publication. The artifact
belongs in the existing environment artifact bucket under `lambda/profile/audit-retention/`.
The existing guarded publisher selects this single-artifact/four-object family with
`-ArtifactFamily PrivilegedAuditRetention`. It runs Profile tests, the dependency audit, two
deterministic builds and existing account/state/bucket/KMS/versioning/source guards. Publication
is a separately authorized action; this source change does not publish anything.

The private Node.js 24 function uses the platform's database secret, key, private subnets,
application security group and log group. Its bounded role has exact secret/key access, VPC
interfaces and logs, with explicit S3, ECS, role-passing and function-invocation denial. The
owning database must exist. IAM restricts AWS capability; the existing application expiry facade
owns row selection. This does not introduce a separate SQL principal. Audit capture uses a separate explicit flag.

Runtime enablement and scheduling default false and are independent inputs. Scheduling requires
runtime enablement. Each hourly invocation supplies only `{schemaVersion:1, action:"expire"}`
to the published numeric function version; the batch is 100 and concurrency is one. The handler
uses database-time age checks and returns only counts. EventBridge retries are disabled because
the next hourly sweep selects remaining due rows. Lambda's asynchronous retries can safely repeat
the expiry operation. Delivery and execution errors alert through the existing operational SNS
topic; there is no event payload requiring a separate dead-letter queue. Monitor actual expiry
capacity before launch if incoming audit volume exceeds the bounded hourly sweep.

Changing the runtime flag publishes a new immutable version. Stop the rule before draining old
invocations; an old numeric version retains its configuration. Do not treat a new disabled
version as revocation of an already queued invocation. Review IAM callers and in-flight work
before disabling maintenance. Never paste audit rows, identities or database errors into alerts.

Local Terraform validation passes for platform, development and staging. Four mocked tests
cover absent defaults, immutable numeric recipient and artifact, restricted permissions/alarms,
and invalid activation/scheduling. Existing actual SQL and Lambda evidence remains in
`docs/product/delivery/evidence/d1-privileged-audit-maintenance-lambda-2026-10-06.md`.
These checks do not establish managed identity, database access, effective IAM or alert delivery.
Artifact publication, reviewed apply, audit capture enablement and managed expiry/alert acceptance
remain required; no cloud resources were changed during implementation.

`privileged_moderation_audit_enabled` separately connects the existing Gateway audit writer.
It defaults false and is omitted from the Gateway environment while disabled, preserving the
existing default configuration. Enabling it requires the owning Gateway/database and enabled
scheduled retention; provisioning a maintenance artifact alone never enables capture. This
configuration prerequisite cannot prove deployed schedule health. Stop capture before disabling
retention, allow the existing retention policy to finish, and account for immutable older Gateway
versions during rollback. Authorization, fixed audit fingerprints and fail-closed write behavior
remain the existing Gateway/Profile implementation; no candidate content enters the new flag.
