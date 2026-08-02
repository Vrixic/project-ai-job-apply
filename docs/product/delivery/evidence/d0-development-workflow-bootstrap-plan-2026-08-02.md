# D0-016 SR-005 development workflow bootstrap plan evidence

- Date: 2026-08-02
- Environment: Development AWS account in `us-east-2`
- Terraform source commit: `3aa5a49a5da51a6087ba72a43c31cedc557eb489`
- Terraform version: `1.9.8`
- Saved-plan SHA-256: `3c0cc743d4a08bb1ee0b97a452889aad75d4d4598b02e0e80bb532e226dcea43`
- Status: Reviewed diagnostic passed; plan is local, sensitive, ignored, and unapplied

## Guarded reconstruction

The plan operator reconstructed the development bootstrap from its encrypted remote
`bootstrap.tfstate` rather than relying on a local backend or stale plan. Before planning, it
verified:

- the temporary IAM Identity Center caller belongs to the exact development account;
- the region is exactly `us-east-2`;
- the repository owner and repository IDs still match the committed immutable OIDC prefix;
- the effective AWS trust requires that immutable subject, exact `development` GitHub Environment,
  and `sts.amazonaws.com` audience;
- the successful protected-environment artifact-publication run used the accepted workflow;
- bootstrap state is a versioned object in the exact private state bucket;
- all four S3 public-access blocks remain enabled; and
- the state bucket and state object use the same customer-managed KMS key with S3 bucket keys.

No account number, state bucket name, KMS identifier, role ARN, credential, token, policy document,
state content, plan content, or candidate data is retained in this record.

## Exact plan result

| Action | Count |
|---|---:|
| Create | 0 |
| Update in place | 3 |
| Delete | 0 |
| Replace | 0 |

The guard accepted only these Terraform addresses:

1. `aws_iam_policy.github_deploy_boundary`
2. `aws_iam_role_policy.github_deploy`
3. `aws_iam_policy.workload_boundary`

It independently parsed both the prior and planned IAM documents. The managed GitHub permissions
boundary and inline role policy are semantically identical before and after the change. Their only
new authority is:

- environment-stack-scoped CloudFormation create/update/read/delete operations for the exact
  profile-readiness durable stack;
- `cloudformation:ValidateTemplate`, whose AWS API requires wildcard resource scope; and
- environment-rule-scoped EventBridge management for the platform's development workflow rules.

The guard explicitly rejected account-wide `cloudformation:*` and `events:*` authority.

The workload boundary changes only by:

- adding `kms:GenerateDataKey` to the existing project/environment-tag-constrained KMS statement;
- adding the three required durable Lambda execution operations, scoped to qualified development
  function ARNs; and
- adding bounded SQS consume/send operations, scoped to development workflow queue ARNs.

All existing VPC-interface, runtime-secret, log, trace, image, and tagged-KMS conditions remain
semantically unchanged.

## Safety boundary and next gate

The plan is stored only below the ignored bootstrap `.terraform` directory. It was not applied,
uploaded, or committed. No IAM, Lambda, CloudFormation, EventBridge, SQS, API route, workflow
trigger, ECS service, Temporal path, or public traffic changed.

Application requires separate product-owner authorization for this exact checksum. After an exact
apply, the operator must regenerate a refresh-backed zero-change bootstrap plan and verify live
managed/inline policy parity before the development dark workflow platform plan is prepared.
