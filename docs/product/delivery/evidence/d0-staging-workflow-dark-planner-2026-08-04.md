# D0-016 staging workflow dark planner evidence

- Date: 2026-08-04
- Environment: Development and isolated synthetic staging source boundary
- Status: Complete; corrected merged-main plan passed and the separately authorized dark deployment is verified
- Runtime change: Dark workflow resources deployed; replacement triggers and public traffic unchanged

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

## First merged-main planning attempt

After the environment-aware source merged, clean upstream-matched `main` resolved the protected
staging account/state inputs, the singular current gateway artifact, all three singular current
workflow artifacts, and the pinned live extension layer without printing their identifiers. The
planner independently passed account, artifact, quota, completed-gateway, idle-ECS, Temporal
dispatch, and trigger-disabled preconditions.

Terraform produced the expected action shape: 38 creates, five bounded updates, zero deletes, and
zero replacements. The planner then rejected its own plan before returning a checksum because the
new durable IAM role made both the propagation gate's role ARN and policy hash plan-time unknown.
That is expected during a first deployment, but the inherited assertion required a known role ARN.
No apply occurred, and the rejected saved plan was removed so it cannot be authorized or reused.

The corrected assertion now requires both the durable role ARN and propagation role reference to
be explicitly unknown during only the initial dark deployment. It likewise requires the
role-dependent policy hash to be unknown during initial deployment or a coupled artifact release.
Recovery and completed verification still require the propagation gate's known role ARN to equal
the exact Terraform-managed durable role and require a non-empty known policy hash. Parser,
wrapper-parity, dirty-source fail-before-AWS, whitespace, and full repository checks pass after the
correction.

No account number, bucket, object key/version, role ARN, endpoint, credential, token, saved plan,
Terraform state, or candidate data is retained in this record.

## Corrected merged-main result

The narrow initial-deployment verifier correction merged and clean upstream-matched `main` at
commit `018e30ff6150248dd69d03646ae172d06fcd4466` produced a new refresh-backed plan from the
protected staging inputs. Independent inspection confirmed exactly 38 creates and five bounded
in-place updates, with zero deletes, replacements, API-routing actions, ECS-capacity actions, or
enabled workflow triggers. The saved plan was separately authorized by its exact SHA-256 before
use.

The checksum-authorized deployment and its refresh-backed zero-change verification are recorded
in the [staging workflow dark-deployment evidence](d0-staging-workflow-dark-deployment-2026-08-04.md).

## Next gate

Generalize and execute the staging workflow dark-conformance boundary, including exact function
rejection paths, DLQ containment, alarm delivery/recovery, privacy-safe log inspection, cleanup,
and post-run zero drift. Keep public traffic on the retained HTTP proxy and keep every workflow
trigger disabled until the separately reviewed staging cutover.
