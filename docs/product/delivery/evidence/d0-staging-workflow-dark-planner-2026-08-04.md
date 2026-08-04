# D0-016 staging workflow dark planner evidence

- Date: 2026-08-04
- Environment: Development and isolated synthetic staging source boundary
- Status: Environment-aware planner source locally verified; no Terraform plan or AWS change
- Runtime change: None

## Shared planning boundary

The proven development workflow-dark operator is now one environment-aware planner that accepts
only `development` or `staging`. The original development command remains a narrow compatibility
wrapper so existing conformance and rollback automation retains one implementation of the planning
rules.

For the selected environment, the shared planner derives its isolated Terraform root, default SSO
profile, resource prefix, Lambda alias, API, ECS cluster, alarms, queue, and durable-stack names. It
delegates the gateway prerequisite to the existing environment-aware completed-dark verifier and
continues to reconstruct every live ECS, RDS, identity, Temporal, observability, and artifact input
rather than accepting an incomplete variable file.

The planner additionally requires:

- clean local `main` at the exact configured upstream commit;
- the exact temporary Identity Center caller in the selected account and `us-east-2`;
- Terraform `1.9.8` and the pinned provider lock;
- explicit remote-state initialization using the selected state bucket's exact customer-managed
  KMS key;
- all three immutable workflow artifacts with exact source/digest metadata, object versions,
  stored checksums, versioning, and customer-managed KMS encryption;
- the reviewed regional Parameters and Secrets extension version;
- sufficient account concurrency while retaining the standard unreserved pool;
- an active, immutable, zero-drift gateway that still dispatches through Temporal;
- stable retained ECS services at one accepted posture; and
- exact initial, recovery, release, or completed-verification action allowlists.

Initial dark planning still requires all SQS and EventBridge replacement triggers to be disabled,
forbids API routing or ECS-capacity actions, and permits no deletion or replacement. The script only
saves a sensitive refresh-backed plan beneath the ignored environment `.terraform` directory; it
does not apply infrastructure.

## Local verification

Windows PowerShell parser and help checks pass for the shared planner and development wrapper. An
AST comparison proves the wrapper exposes and forwards the shared parameter surface except for its
fixed environment. A staging safety probe with structurally valid synthetic inputs rejected the
dirty worktree before any AWS read. Repository formatting, lint, type checks, unit tests, skill
validation, and serverless infrastructure-policy validation pass through `pnpm check`.

No account number, bucket, object key/version, role ARN, endpoint, credential, token, saved plan,
Terraform state, or candidate data is retained in this record.

## Next gate

Merge this source and synchronize clean `main`. Resolve the protected staging inputs without
printing them, generate the refresh-backed initial staging workflow-dark plan, audit its exact
resource actions and policy semantics, and request separate authorization for that plan's SHA-256
before applying it. Traffic must remain unrouted and every replacement trigger disabled.
