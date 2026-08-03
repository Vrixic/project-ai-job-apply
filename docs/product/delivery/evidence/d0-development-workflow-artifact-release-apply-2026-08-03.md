# D0-016 development workflow artifact-release apply evidence

- Date: 2026-08-03
- Environment: Development AWS account in `us-east-2`
- Terraform source commit: `427b99541bc7273b1643f3593f8b8afd3a6c188f`
- Authorized plan SHA-256: `d55e3b95266c154a54cf597cd2043d2767af5783031f0fc8e4132b50f02b1950`
- Terraform version: `1.9.8`
- Status: Exact release apply and refresh-backed zero drift passed; corrected-artifact conformance remains open

## Authorization and exact apply

The product owner explicitly authorized the exact merged-main plan by its SHA-256. Immediately
before apply, the operator rechecked the clean `main` commit, Terraform version, saved-plan
checksum, development caller against the planned account, and the exact action addresses. It
applied the saved file directly without replanning.

Terraform completed exactly:

| Action | Count |
|---|---:|
| Create | 0 |
| Update in place | 14 |
| Delete | 0 |
| Create-before-delete replacement | 1 |

The updates selected the corrected immutable ingress, activity/terminal, and durable artifacts;
published new retained versions; advanced the four Terraform aliases and the durable stack alias;
and updated only the exact-version terminal pattern and policy documents coupled to those new
versions. The one replacement was the policy-hash-keyed 45-second IAM propagation gate. No other
resource action occurred.

## Post-apply verification

The exact merged source and deployed artifact inputs produced a refresh-backed zero-change plan:
zero creates, updates, deletes, and replacements. The verifier revalidated all three immutable
artifact objects, the pinned regional Secrets extension, Temporal dispatch, disabled workflow
triggers, unchanged API traffic, and unchanged ECS capacity.

The durable CloudFormation stack reached the healthy terminal `UPDATE_COMPLETE` state. The first
read-only conformance-context attempt rejected before creating a context or invoking Lambda because
the operator accepted only the initial-deployment `CREATE_COMPLETE` state. The verifier correction
accepts exactly `CREATE_COMPLETE` or `UPDATE_COMPLETE` and carries the actual state into the
checksum-gated context; it does not accept in-progress, rollback, or failure states. That correction
is not yet merged, so no corrected-artifact conformance execution is claimed here.

## Safety result and next gate

The corrected workflow artifacts are deployed to the dark development aliases. The SQS and both
EventBridge replacement triggers remain disabled, public API traffic remains on the ECS/Cloud Map
rollback path, ECS capacity is unchanged, and gateway dispatch remains on Temporal. No synthetic
or product workflow was invoked during apply or the rejected conformance-plan attempt.

Merge the terminal-stack-state verifier correction, regenerate zero drift from exact clean `main`,
and create a fresh checksum-reviewed conformance context. Execute its four synthetic fail-closed
probes only after separate checksum authorization, then inspect aggregate logs/alarms and exercise
a separately reviewed known-good release rollback before any trigger cutover.

No account identifier, bucket/object version, KMS identifier, role/function/queue/service ARN,
credential, token, OIDC value, Temporal value, policy body, state/plan content, raw Terraform/log
output, or candidate data is retained here.
