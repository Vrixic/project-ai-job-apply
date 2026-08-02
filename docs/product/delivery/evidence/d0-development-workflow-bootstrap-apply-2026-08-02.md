# D0-016 SR-005 development workflow bootstrap apply evidence

- Date: 2026-08-02
- Environment: Development AWS account in `us-east-2`
- Exact merged source: `1bb7d1f105b55ca097671666a398ba5fe5a5ffaa`
- Terraform version: `1.9.8`
- Applied-plan SHA-256: `be1bd31750786f09ee7b907e8b068c515f3d7ffe8d0611d3ced6246463be9d88`
- Authorization: Product owner supplied the exact environment, plan purpose, and checksum
- Status: Applied and refresh-backed zero drift

## Exact-plan preflight

Immediately before application, the guarded preflight verified:

- local `main` was clean and synchronized to the exact merged source;
- the saved plan bytes matched the authorized SHA-256;
- the temporary IAM Identity Center caller belonged to the development account;
- the target region was exactly `us-east-2`;
- the saved plan remained readable by Terraform 1.9.8; and
- its only actions were three in-place updates to the GitHub deployment managed boundary, matching
  inline deployment policy, and workload permissions boundary.

No newly generated or differently checksummed plan was substituted after authorization.

## Apply result

| Action | Count |
|---|---:|
| Create | 0 |
| Update in place | 3 |
| Delete | 0 |
| Replace | 0 |

The apply changed no Lambda function, CloudFormation stack, EventBridge rule, queue, API route,
workflow trigger, ECS service, Temporal execution path, data resource, or public traffic. It only
made the already reviewed least-privilege deployment and workload permissions effective.

## Live verification

After application:

- an independently generated refresh-backed bootstrap plan reported zero changes;
- the live managed deployment boundary and inline role policy were semantically equivalent;
- the effective role trust retained the immutable repository-ID subject, exact protected
  `development` Environment, and exact AWS audience;
- CloudFormation authority was limited to the exact development durable stack plus template
  validation;
- EventBridge authority was limited to development workflow rules;
- no `cloudformation:*` or `events:*` action was present;
- durable Lambda execution permissions were limited to qualified development functions;
- workflow queue permissions were limited to development queues;
- `kms:GenerateDataKey` remained under the existing project/environment resource-tag condition;
- IAM Access Analyzer reported zero errors and zero security warnings for both effective managed
  policies; and
- the updated bootstrap state remained a non-empty, versioned, bucket-key-enabled object encrypted
  by the state bucket's customer-managed KMS key.

No account number, bucket name, KMS identifier, role ARN, credential, token, policy body, state
content, plan content, or candidate data is retained in this record.

## Next gate

The development bootstrap prerequisite is complete. SR-005 remains in progress: the next action is
to reconstruct the exact existing development platform inputs and immutable workflow artifacts,
then generate a separately reviewed dark platform plan. That plan must keep every workflow trigger
disabled, keep gateway workflow dispatch on Temporal, retain ECS/Temporal as the live rollback path,
and reject any public route or traffic change.
