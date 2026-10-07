# Private Jobs retention release

`job_retention_release` is null by default. An exact immutable receipt creates a private Node24
Lambda, owning database/key/VPC/log role, disabled hourly rule and execution/delivery alarms.
Development and staging expose the same inputs. `job_retention_enabled` and
`job_retention_schedule_enabled` default false; scheduling requires runtime enablement. No tfvars
are populated. The schedule targets a numeric version with only `{schemaVersion:1,action:"expire"}`.
The function uses one connection, concurrency one, a 90-second timeout and a 100-row batch. This
allows the existing two bounded SQL expiry statements plus connection and secret lookup time.

The owner transaction expires eligible reporter links before retiring closed moderation cases,
retaining active catalog controls as already specified by Jobs migrations 0025/0026. Migrate and
deploy aggregate-aware readers before cleanup. The runtime uses raw PostgreSQL field/JSON behavior,
returns only four bounded counts and closes its connection on either outcome. It does not expose
report or operator records. PUBLIC function execution remains refused by the existing migrations.
Managed identity checks bind the exact numeric recipient; invocation authority comes from IAM.

The strict private handler rejects ambient DATABASE_URL, invalid targets, extra/accessor input,
warm configuration drift and overlapping calls. Runtime withdrawal prevents admission or withholds
a response; it cannot undo a database transaction already committed. Retry selects remaining due
rows rather than inventing a replay result. EventBridge retries are disabled because the next
hourly sweep resumes eligible work; Lambda async retry is idempotent. Monitor expiry capacity
against actual incoming volume. Old numeric versions retain their flags: stop scheduled intake
and account for in-flight invocations before rollback. Deleted linkage cannot be recreated.

Build with `pnpm --filter @ai-job-apply/workflows build:lambda:job-retention`. This compiles
workspace dependencies before emitting one artifact and four publication companion files. The
maintained publisher selects `-ArtifactFamily JobRetention`, with independent output/key/receipt
roots under `lambda/jobs/retention/`. Existing source, audit, account/state, KMS/versioning and
exact readback gates apply. Publication and deployment require separate release authorization.

Local checks include 21 handler cases, nine PostgreSQL 16.6 moderation-retention cases (one through
the actual compiled Lambda/runtime), four mocked Terraform cases, both environment validations,
publisher receipt guards and compilation/Biome. Managed secret lookup is simulated in SQL tests;
SQL expiry and replay are real. Managed IAM, migrations, secret/network access, scheduling, alarms
and release acceptance remain unverified. No cloud publication or activation occurred.
