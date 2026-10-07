# D1 private privileged audit maintenance Lambda — 2026-10-06

Status: default-off source and local evidence; D1/D3 remain In progress.

D1-012 now has a separate executable maintenance entrypoint for the accepted 365-day privileged
access/action audit expiry. It reuses the Profile-owned exact-format bounded transaction added
in [audit evidence](d1-privileged-moderation-audit-2026-10-06.md). No schema, migration, public
contract, Gateway capture semantics, candidate export or case-history lifetime changes occur.

`privileged-moderation-audit-retention-lambda.handler` accepts only the closed data-only
`{schemaVersion:1, action:"expire"}` envelope. It refuses extra fields/accessors before secret or
SQL access. Its invocation context must equal the numeric own function version in the configured
us-east-2 account. These identity checks are configuration guards, not caller authentication;
reviewed private invocation IAM remains required. No public route or invocation grant is created.

Retention defaults off. Literal enablement, bounded canonical batch (default 100, maximum 1000),
qualified same-account managed database-secret ARN, runtime session context and exact function
identity are required. DATABASE_URL overrides are refused. Configuration is pinned after first
valid admission; warm secret/target/batch drift refuses without repinning, while session token
rotation is allowed. Existing bounded local Secrets extension lookup supplies the owner URL.
Flag/configuration withdrawal during lookup cannot create a SQL runtime.

Each invocation owns one native Profile PostgreSQL pool with a 10-second statement timeout and
an expiry-only facade. The existing transaction rechecks admission after actual SQL and rolls
back if withdrawn. No locks cross secret lookup; a pool is closed after success or failure.
Concurrent invocation refuses without releasing the original guard. Fixed errors suppress raw
SQL/secret details. Response contains only schemaVersion, fixed owner and bounded expired count,
never operator fingerprints or row identifiers. Withdrawal after commit or while closing withholds
the response; it cannot undo a transaction already committed. A retry safely selects remaining due
rows, not an invented replay count or all-copy deletion assertion.

The builder emits a separate ZIP and provenance/SBOM/checksum companions below
`backend/services/profile/dist/audit-retention-lambda`, using the existing source-bound artifact
builder. `pnpm --filter @ai-job-apply/profile-service build:lambda:audit-retention` runs an actual
emitted cold default-off refusal without network. The full verifier now includes the emitted
maintenance dependency isolation check. No publisher, Terraform resource, scheduler, role/grant,
cloud deployment, activation, main merge, new PR or hosted CI/CD work is added.

Local evidence:

- Profile build passes after correcting an optional-session-token typing error.
- Nineteen focused cases pass: managed composition, invalid configuration before effects, strict
  input/recipient, warm drift/credential rotation, lookup withdrawal, fixed SQL errors, invalid
  counts, expiry/close withdrawal and overlapping calls. Owner/secret ports are simulated here.
- Seven real PostgreSQL cases pass with actual Profile migrations replayed twice in a newly owned
  PostgreSQL 16.6 loopback tmpfs fixture. The added case uses actual Lambda factory, actual runtime
  and expiry transaction: bounded two then one then zero, with a withdrawn in-transaction operation
  retaining the remaining record. Managed identity/secret lookup are synthetic; SQL and connection
  cleanup are real. Existing capture/age/foreign/export/concurrency cases remain passing.
- Actual emitted isolation passes: only the three Profile owner modules plus postgres/uuid enter;
  no AWS SDK/model/renderer/object/Gateway/application consumer is bundled.
- Initial local artifact builds: 22,742 bytes, two SBOM components, cold default-off refusal passes.
  This initial build uses local provenance; exact committed-source builds/full verification remain.
- Unsafe throwing from a finally block is corrected before final verification; cleanup failure and
  primary failure are reduced to the fixed error after cleanup rather than overriding control flow.

Logs: `.tmp/d1-audit-maintenance-{build,tests,sql,bundle,artifact-local}.log`.
Owned SQL fixture is removed after exact label validation; shared volumes remain. Docker/WSL are
stopped. Development web will pause only while the full verifier reserves localhost:3000, then
be restored. The PC remains on. Managed secret extension/runtime/IAM/scheduling/release, alert
retention verification and independent security/rights/phase acceptance remain open.

## Clean-source full verification and artifact integrity

Frozen clean source `be646832f61eb520f7193026a7429f3827cbf4d9` passes the original
`scripts/verify-phase0.ps1` run with matching ARTIFACT_SOURCE_SHA and exit zero: 38 typecheck
tasks, 39 test tasks, 23 production builds, operator/security/formatting/Compose checks and every
emitted isolation check, including the new audit-maintenance check. Lint remains zero errors,
15 warnings and 58 infos. Tracked source stays unchanged while the original handle is alive.
Full log: `.tmp/d1-audit-maintenance-full.log`. Opt-in SQL remains skipped in workspace tests;
the seven explicit actual PostgreSQL cases above remain separate evidence.

The separate committed-source artifact builds twice byte-identically across all five output
files. ZIP is 22,777 bytes with SHA-256
`ff17b7ef4e441bd8b848e9ffa90b6e19167d87f23c1b39f742bba132c25b7fe4`.
Manifest binds the exact source, Node.js 24/x86_64 and `index.handler`; SBOM has two components.
Independent ZIP/manifest/bundle/SBOM hash and component checks pass. All five hashes still match
after full verification. Logs: `.tmp/d1-audit-maintenance-artifact-{first,second}.log`; local hash
receipt: `.tmp/d1-audit-maintenance-artifact-hashes.json`. No artifact is published or deployed.

The maintained launcher restores development web against the live development API. Anonymous
root returns 200 and `/resume` returns 307 with redirects disabled. Only the two generated Next
development-type imports are restored after diff inspection; no frontend feature changes occur.
This startup check does not claim new authenticated acceptance or repeat the owner's accepted
Profile/save/reload steps. Docker/WSL remain stopped, shared volumes retained and PC on.

Managed runtime/Secrets extension, reviewed invocation IAM, scheduling/release, audit security/
rights review and alert storage/retention acceptance remain. D1/D3 remain In progress; full local
verification does not close their deployed, provider, browser, ATS or accountable review gates.


## Optional release composition

The platform now accepts a nullable immutable audit-retention artifact receipt, forwarded by
both environment roots. Default null creates no resources. The private Node24 Lambda pins the
artifact object version and existing numeric Secrets extension, owning database secret/key,
private network and application logs. Its role explicitly denies object/task/role-passing/other
function capabilities. Runtime and hourly schedule gates default false; the rule targets the
numeric published version with only the existing expire envelope. Batch100/concurrency1 bounds
work; fixed execution and event-delivery alarms use the existing operational SNS topic.

Four mocked cases pass, covering no resources by default, disabled concrete release, exact
numeric/artifact/envelope binding, secret/content authority and alarms, and invalid enablement.
Platform and both environment roots validate. Log: `.tmp/d1-audit-retention-terraform.log`.
An initial undeclared secret reference was corrected to the actual platform database_url resource
before these results. These checks are local synthetic-provider evidence; earlier real SQL and
handler evidence remains separate. No publication or deployment occurred.

The module release guide records retry/drain behavior and remaining publication, managed access,
expiry and alarm acceptance. Existing audit capture remains separately gated. Application expiry
facade restrictions are not a new database-grant boundary. IAM effect, provider integration,
real-data permission and accountable phase acceptance remain open.


## Guarded publication family

The maintained document/workflow publisher now selects PrivilegedAuditRetention as a separate
one-artifact/four-object family, matching the existing Profile builder and Terraform key prefix.
Output and receipt roots are separate; existing families remain unchanged. Publication selects
Profile tests and its audit-retention build twice while retaining source, dependency audit,
account/state, bucket/version/KMS and independent exact-version readback gates.

Local pure-function tests pass for case-insensitive family routing, the exact four-object receipt,
foreign/mixed/incomplete/duplicate rejection, and the existing family regression suite. Log:
`.tmp/d1-audit-publication-guards.log`. No publisher cloud entrypoint was executed. Actual
clean-source build and local artifact readback follow; managed publication remains unperformed.


Actual publisher local readback at clean `dc5da2f2` validates all four files and source markers;
repeat emission is byte-identical (22,777-byte ZIP). Profile was compiled immediately before
this readback. Review found that the package artifact command itself assumed existing compiled
output; it now explicitly runs Profile compilation before packaging so publication cannot skip
that step. A fresh committed-source artifact check follows this correction.


Corrected clean source `91dd7478922f62213b86f908e50c0ec5e0220820` passes the package command's
Profile compilation, emitted default-off refusal, actual publisher readback of all four files
and byte-identical repeat emission. ZIP SHA-256
`afb9234e1b85cd3e2f2a41a3a5f241f6ac9952b0ff68058f233a94d6b83ea716`, 22,777 bytes, two SBOM
components. Logs: `.tmp/d1-audit-publication-build.log`, `.tmp/d1-audit-publication-readback.log`;
local receipt `.tmp/d1-audit-publication-local-receipt.json`. Package Biome check passes. This
is local integrity/reproducibility evidence, not a fresh dependency audit, cloud publication or
managed release. D1/D3 remain In progress.


## Audit capture release flag

The existing Gateway audit implementation now has a platform input forwarded by development and
staging: privileged_moderation_audit_enabled, false by default. Only explicit enablement supplies
the existing runtime environment flag. Validation requires the owning Gateway/database and
scheduled audit retention, preventing a release configuration that enables capture without its
expiry path. The guide records capture-first shutdown and immutable-version limitations.

Six mocked audit-release cases pass, including connected Gateway capture/maintenance and refusal
without prerequisites. Both environment roots validate. Log:
`.tmp/d1-audit-capture-terraform.log`. The connected test initially omitted the existing
application deployment prerequisite; its fixture was corrected before final pass. No Gateway
handler, schema or row semantics changed. Existing real SQL/capture evidence remains separate;
managed audit capture/expiry, effective IAM, alert delivery and phase acceptance remain open.

The existing serverless-runtime Terraform suite also passes all 51 mocked cases on this source,
including dark Gateway routing and dormant-environment behavior. Log:
`.tmp/d1-audit-capture-serverless.log`. No live runtime or source artifact was changed.
