# D0-016 SR-005 serverless workflow infrastructure source evidence

- Date: 2026-08-02
- Scope: disabled durable-workflow/outbox infrastructure, runtime/deployment IAM, checkpoint and
  DLQ encryption, private database access, observability, and immutable artifact publication
- Status: Source review ready; no artifact object, AWS plan/apply, trigger, route, or traffic changed

## Implemented boundary

Both development and staging now compose the same opt-in replacement boundary. It creates the
identifier-only SQS starter and reconciler, a Lambda durable profile-readiness orchestrator, a
private exact-version activity handler, an idempotent private terminal handler, private
Secrets/SQS/Lambda endpoints, a dedicated encrypted terminal DLQ, and replacement alarms.

The deployment controls remain independent:

- `deploy_profile_readiness_durable` creates the durable/activity/terminal boundary;
- `deploy_serverless_outbox` creates the starter/reconciler boundary only when the durable target
  also exists; and
- `enable_serverless_workflow_triggers` defaults to `false` and alone controls the SQS event-source
  mapping, reconciliation schedule, and durable terminal-event rule.

The gateway retains `gateway_outbox_dispatch_target = "temporal"` during dark deployment. No
resource in this change modifies the public API integration. Every artifact input requires an
exact versioned S3 object plus hexadecimal and base64 SHA-256 digests.

## Security, privacy, and replay controls

- The durable orchestrator runs outside the VPC, receives opaque identifiers, has no database
  secret, and may invoke only the exact numeric activity version.
- Activity and terminal handlers are capped at one concurrent invocation each, enter only private
  subnets, and fetch the database value from the exact managed secret through the pinned regional
  AWS Parameters and Secrets extension.
- The durable role is limited to its own checkpoint/state APIs, the exact activity version,
  native trace writes, and the identifier-only encrypted DLQ.
- The platform CMK policy scopes durable state use to the exact account/function/encryption
  context, encrypted DLQ writes through SQS, and terminal delivery from the exact EventBridge rule.
- Durable versions use `DeletionPolicy` and `UpdateReplacePolicy` retention so an infrastructure
  release cannot remove code still required by an older execution.
- FAILED, STOPPED, and TIMED_OUT status events target the idempotent terminal handler. The event
  rule remains disabled before cutover and has bounded retry plus the dedicated DLQ.
- GitHub deployment permissions add only the environment durable stack and environment event-rule
  actions; they do not add account-wide CloudFormation or EventBridge administration.

The pinned Terraform AWS provider exposes durable timeout and retention but not
`DurableConfig.KMSKeyArn`. Terraform therefore owns one narrowly scoped CloudFormation stack for
only the durable function, version, and alias. This preserves declarative customer-managed
checkpoint encryption and drift visibility without an imperative post-deploy mutation. All other
resources remain native Terraform.

## Artifact publication

The manual `Publish workflow Lambda artifacts` GitHub workflow runs only from `main` inside the
selected protected GitHub Environment. It uses short-lived AWS OIDC credentials, builds all three
artifacts twice, compares their digests, verifies CycloneDX 1.6 evidence, audits dependencies at
High severity, verifies the private versioned KMS-encrypted artifact bucket, and refuses to append
another object version to an existing immutable key. It publishes sanitized exact keys, object
versions, and digests but never deploys a function or enables a trigger.

## Local validation

- Serverless workflow infrastructure policy validation: passed.
- Platform Terraform validation: passed.
- Terraform plan test: one passed, zero failed. It verifies the opt-in boundary, private capped
  database handlers, and disabled terminal recovery.
- Development and staging environment Terraform validation: passed.
- Bootstrap Terraform validation: passed.
- Reproducible workflow Lambda build: passed with the exact SR-004 artifact digests.
- Repository formatting and diff checks: passed.

## Remaining SR-005 gates

This evidence does not complete SR-005. After merge, the next changes are deliberately separated:

1. publish the three exact merged artifacts independently to development and staging;
2. generate and review the bootstrap IAM plan in each account;
3. generate a refresh-backed dark platform plan with all triggers disabled, Temporal routing
   unchanged, and no deletion/replacement;
4. apply only an explicitly authorized checksum-matched plan and prove direct dark conformance,
   alarms, logs, checkpoint encryption, DLQ behavior, rollback, and no drift; and
5. prepare separate cutover and old-runtime retirement plans. No retirement may occur in the dark
   deployment change.
