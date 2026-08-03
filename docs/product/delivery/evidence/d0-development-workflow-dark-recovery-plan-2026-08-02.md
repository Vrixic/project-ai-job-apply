# D0-016 SR-005 development workflow dark-recovery plan evidence

- Date: 2026-08-02
- Environment: Development AWS account in `us-east-2`
- Terraform source commit: `f0f5af2cb71bddebe6c2e5e49970ebf11802a3eb`
- Terraform version: `1.9.8`
- Diagnostic plan SHA-256: `6137fc470e992201a0cf26dda272d33d26bb478cbd27352416182845232abc56`
- Status: Guarded partial-recovery diagnostic passed; sensitive plan is local, ignored, and unapplied

## Recovery prerequisites

The operator reconstructed the partial boundary from encrypted remote state after initializing the
exact committed AWS, Random, and Time providers. It independently verified all three immutable
workflow artifact versions/checksums/metadata, the pinned official regional Secrets extension,
the temporary development caller, and sufficient Lambda concurrency.

The failed durable function remains absent. IAM simulation now evaluates the durable role's exact
`sqs:SendMessage` action on only its owned terminal DLQ as `allowed`. The recovery source adds a
45-second propagation resource whose replacement triggers bind the exact role ARN and SHA-256 of
the generated policy before CloudFormation can validate the function's DLQ configuration.

## Exact diagnostic result

| Action | Count |
|---|---:|
| Create | 15 |
| Update in place | 0 |
| Delete | 0 |
| Replace | 0 |

The 15 creates are exactly:

- the policy-hash-keyed IAM propagation gate and the durable CloudFormation stack;
- the outbox starter policy, function, immutable alias, disabled partial-batch event-source
  mapping, and two alarms;
- the profile-readiness terminal function, immutable alias, disabled terminal rule, target,
  exact-rule invocation permission, and terminal DLQ queue policy; and
- the private Lambda interface endpoint.

The diagnostic permits no update to any of the 23 retained dark resources or five completed
in-place updates from the stopped apply.

## Dark-boundary checks

The saved plan proves:

- gateway dispatch remains exactly `temporal`;
- the SQS mapping and both EventBridge rules are `DISABLED`;
- ordinary and durable functions select the exact versioned artifacts, checksums, layer, and
  bounded concurrency;
- the durable function remains outside the VPC while database handlers remain private;
- no API Gateway API, integration, route, or stage change;
- no ECS cluster, service, task definition, capacity, or image change;
- no update, deletion, replacement, or action outside the exact 15-create allowlist; and
- no cloud mutation because the plan was not applied.

No account identifier, bucket, KMS identifier, role or queue ARN, credential, token, OIDC value,
Temporal value, policy body, state content, plan content, or candidate data is retained here.

## Next gate

Merge the propagation/recovery source and evidence, synchronize exact `main`, then regenerate the
recovery plan. A changed checksum requires new explicit authorization. Successful recovery must be
followed by live function, disabled-trigger, alarm, IAM/KMS/endpoint, artifact, ECS/API/Temporal
stability, and refresh-backed zero-drift proof before development dark deployment is accepted.
