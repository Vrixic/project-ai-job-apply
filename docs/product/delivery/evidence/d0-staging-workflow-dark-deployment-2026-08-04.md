# D0-016 staging workflow dark-deployment evidence

- Date: 2026-08-04
- Environment: Isolated synthetic staging
- Status: Accepted dark deployment; conformance and cutover remain open
- Runtime source: `018e30ff6150248dd69d03646ae172d06fcd4466`
- Workflow artifact source: `a68f36d5f55521c0221df38d9d1d4c375d88824d`

## Reviewed plan

The environment-aware planner reconstructed the protected staging caller, encrypted remote state,
existing gateway/ECS/API boundary, exact immutable gateway and workflow artifacts, pinned
Parameters and Secrets extension, and the effective regional Lambda concurrency quota without
printing or retaining protected identifiers.

The fresh plan contained exactly:

- 38 creates for the workflow functions and immutable aliases, least-privilege roles and policies,
  private Lambda/SQS endpoints, encrypted durable DLQ, disabled SQS/EventBridge triggers, seven
  alarms, the customer-KMS durable CloudFormation stack, and its deterministic IAM propagation
  gate;
- five bounded in-place updates to add identifier-only outbox configuration to the gateway while
  retaining Temporal dispatch, advance its immutable alias, and extend only the required gateway,
  KMS, and Secrets Manager endpoint policies; and
- zero deletes, replacements, API route/integration/stage actions, ECS-capacity actions, enabled
  workflow triggers, or data-resource actions.

The plan SHA-256 was
`500b3c435669320aa686b0a26777bc54309a208252ddc5d5f1c64f08d5557ded`. The product owner
authorized that exact checksum before apply.

## Apply handling

The local command wrapper reached its output timeout after Terraform started. The original
Terraform process remained active, so no second apply or state mutation was started. Read-only AWS
inspection showed the durable stack complete while the remaining resources converged; the original
process then exited after all five workflow functions and the disabled SQS mapping existed.

This interruption does not substitute for apply evidence. Acceptance rests on the independent live
inventory and the subsequent refresh-backed exact-input zero-change plan. A separate null-recursion
defect in an ad hoc state-inspection wrapper was corrected locally before rerunning verification; it
did not change source, Terraform state, or AWS.

## Post-apply verification

The completed-dark verifier reconstructed the exact protected inputs and returned a refresh-backed
plan with zero creates, updates, deletes, or replacements. Its diagnostic SHA-256 was
`15fe0cac166b26526850cb7338c16a91cccfc78ebf436f6a33731ca92020b93d`.

Independent live AWS inspection then confirmed:

- five workflow functions and five environment aliases target immutable published versions;
- normal workflow functions are capped at reserved concurrency `1`, the durable function is capped
  at `2`, and the account concurrency quota is `1000`;
- the SQS mapping is `Disabled` with partial-batch failure reporting and both EventBridge schedules
  are `DISABLED`;
- the durable CloudFormation stack is complete;
- the dead-letter queue uses the environment customer-managed KMS key and 14-day retention;
- both new interface endpoints are available with private DNS;
- all seven workflow alarms have both ALARM and OK delivery actions;
- retained gateway and worker ECS services remain at zero desired, running, and pending tasks;
- API Gateway still has one HTTP-proxy integration, no Lambda integration, and no JWT route; and
- the gateway has the identifier-only outbox queue configuration but still selects Temporal, so no
  user request or outbox event can enter the dark replacement path.

The worktree remained clean at the exact source commit. No account number, bucket, object key or
version, ARN, endpoint, credential, token, Terraform state, preference value, identity, or candidate
data is retained in this record.

## Accepted scope and next gate

The staging workflow infrastructure is deployed and drift free, but it is deliberately dark. This
record does not claim authenticated gateway acceptance, workflow conformance, alarm-notification
receipt, accepted-release rollback, API/outbox cutover, Temporal retirement, or obsolete-resource
removal.

The shared staging-capable operator is now locally verified in
[source evidence](d0-staging-workflow-dark-conformance-operator-2026-08-04.md). Merge it, regenerate
the exact-commit zero-change plan, and create a separately reviewed conformance context before the
synthetic rejection/DLQ/alarm drill. Public routing and normal outbox dispatch remain unchanged
until that evidence passes and a separate cutover plan is reviewed.
