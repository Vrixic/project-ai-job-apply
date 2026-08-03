# D0-016 SR-005 development workflow dark-recovery apply evidence

- Date: 2026-08-02
- Environment: Development AWS account in `us-east-2`
- Terraform source commit: `85626faee709230a37a321ae83dceefa12f32755`
- Authorized recovery-plan SHA-256: `931d3c98c15706a372c011c14adde372da7e120b873a57ef5de2e711f7a3d81a`
- Terraform version: `1.9.8`
- Status: Recovery apply and post-apply dark-boundary verification passed

## Authorization and exact apply

The product owner explicitly authorized the exact merged-main partial-recovery plan by its
SHA-256. Before apply, the operator rechecked the clean source commit, ignored sensitive-plan
location, temporary development IAM Identity Center caller, and plan checksum. The saved plan was
applied directly without replanning.

The recovery completed the policy-hash-keyed 45-second IAM propagation gate before creating the
durable function stack. CloudFormation then reached `CREATE_COMPLETE`, and Terraform completed
with exactly:

| Action | Count |
|---|---:|
| Create | 15 |
| Update in place | 0 |
| Delete | 0 |
| Replace | 0 |

No target, trigger, route, ECS capacity, Temporal dispatch, or other unreviewed mutation was added
to the authorized recovery boundary.

## Live dark-boundary verification

Read-only AWS verification established:

- all five workflow functions are `Active` with successful updates and immutable development
  aliases targeting published version `1`;
- reserved concurrency is `1` for each bounded ingress/database/terminal handler and `2` for the
  durable coordinator;
- the outbox SQS event-source mapping is `Disabled` and retains partial-batch failure reporting;
- the outbox reconciler and durable-terminal EventBridge rules are both `DISABLED`;
- all seven workflow alarms are enabled, have exactly one ALARM and one OK action, and are `OK`;
- the terminal DLQ has zero visible and zero in-flight messages;
- the Secrets Manager, SQS, and Lambda interface endpoints are all `available`;
- the durable function retains the reviewed KMS configuration, 30-day history retention, and
  3,600-second execution timeout; and
- the durable CloudFormation stack is `CREATE_COMPLETE`.

Public routing and rollback capacity did not change. API Gateway still uses `HTTP_PROXY` through
Cloud Map, the gateway and Temporal workflow-worker ECS services each remain active at one desired
and one running task with completed rollouts, and the gateway's deployed outbox dispatch target
remains `temporal`.

## State and drift proof

The post-apply refresh-backed Terraform diagnostic from the exact source and applied inputs found
no differences: zero creates, updates, deletes, or replacements. The ignored diagnostic plan was
not applied. The remote state object remains customer-KMS encrypted with an S3 bucket key, has an
object version, and resides in a versioning-enabled bucket; the backend configuration continues to
require the KMS key.

No account identifier, bucket, KMS identifier, role, function, queue or service ARN, credential,
token, OIDC value, Temporal value, policy body, state content, plan content, or candidate data is
retained here.

## Result and next gate

The development workflow replacement boundary is completely deployed and dark. This closes the
IAM-propagation recovery blocker; it does not authorize traffic cutover, enable any replacement
trigger, retire ECS/Temporal, or claim staging acceptance. SR-005 remains in progress for controlled
development dark conformance/rollback, staging publication and dark deployment, cutover support,
and retirement automation.
