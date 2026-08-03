# D0-016 SR-005 development workflow dark-apply failure evidence

- Date: 2026-08-02
- Environment: Development AWS account in `us-east-2`
- Authorized source commit: `a4b7059dd5f86e8c37418185002d5b6d814d9e92`
- Authorized plan SHA-256: `1190110f76e9c63e4f9767b5f585478a500b9d51f2fe4ccd43a605bcdc6a02b7`
- Status: Exact apply stopped; guarded partial recovery required

## Failure boundary

The product owner explicitly authorized the exact merged-main saved plan. Terraform rechecked the
source commit, clean worktree, checksum, temporary development caller, region, and customer-KMS S3
backend before applying that binary plan.

AWS accepted five bounded in-place updates and 23 of the intended dark creates. The nested
CloudFormation stack then attempted to create the durable function immediately after Terraform
created its execution-role inline policy. Lambda rejected `DeadLetterConfig` because the role's
new exact `sqs:SendMessage` grant had not propagated to the authorization path. CloudFormation's
configured failure behavior deleted the failed stack and durable function. Terraform stopped; it
did not continue with the 13 downstream creates.

No deletion or replacement was planned or performed. The authorized saved plan is consumed by the
partial apply and must never be reused.

## Safety and diagnosis

Read-only post-failure checks proved:

- IAM now evaluates the durable role's `sqs:SendMessage` action on only the owned terminal DLQ as
  `allowed`, and its inline policy contains exactly that grant;
- the failed CloudFormation stack and durable function are absent after rollback;
- the created outbox reconciliation rule is `DISABLED`, and no starter event-source mapping
  exists;
- API Gateway still has one `HTTP_PROXY` Cloud Map integration and no Lambda integration;
- the gateway and Temporal workflow-worker ECS services are both active at desired/running `1`,
  with no pending task and one deployment each; and
- no traffic, outbox dispatch, or workflow-engine cutover occurred.

This evidence distinguishes an eventual-consistency race from a missing or overbroad permission.
Broadening IAM would not be an appropriate correction.

## Corrective design

The durable CloudFormation stack will depend on a Terraform `time_sleep` propagation gate. Its
replacement triggers contain the exact role ARN and SHA-256 of the generated durable policy, so
initial creation and future policy changes wait before Lambda validates the DLQ configuration.
Both persistent environment roots pin the official `hashicorp/time` provider.

A separate recovery mode reconstructs live inputs from encrypted state, requires the effective
exact DLQ permission and absent durable function, allows only the known remaining creates, keeps
all triggers disabled and dispatch on Temporal, and rejects updates, deletes, replacements,
API-routing changes, and ECS-capacity changes. Recovery requires merge, exact-main regeneration,
and a new explicit checksum authorization.

No account identifier, bucket, key ARN, role ARN, queue ARN, credential, token, OIDC value,
Temporal value, policy body, state content, plan content, or candidate data is retained here.
