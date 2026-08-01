# D0-016 Development Gateway Dark-Plan Evidence — 2026-07-31

- Environment: development
- AWS account: `362544434697`
- AWS region: `us-east-2`
- Artifact source: `92e5b8f17a898c2970a4231c8a8b4e06c988be80`
- Artifact SHA-256: `f411b840aec7d631565ecab34e34a164680db49ad64cb2e2b691b3051214560d`
- Plan class: refresh-backed, create-only dark deployment
- Terraform apply: first exact apply stopped safely after four creates; recovery plan not applied
- API traffic change: none

## Extension resolution

The plan operator queried the AWS-owned public Systems Manager parameter
`/aws/service/aws-parameters-and-secrets-lambda-extension/x86/latest` in `us-east-2`. It resolved
to the exact x86_64 layer below:

`arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:113`

AWS `GetLayerVersionByArn` confirmed version 113, the expected Parameters and Secrets description,
and only the `x86_64` compatible architecture. Resolving the official public parameter is preferred
to copying a static documentation table because the published version can advance independently.
The saved plan pins version 113; it does not reference `latest` dynamically.

AWS reference: [Using Parameter Store parameters in Lambda functions](https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html).

## Rejected first plan

The first provider-6 refresh-backed plan proposed `12 to add, 2 to change, 1 to destroy`. It would
have replaced the live Cloud Map gateway service because provider-5 state retained an AWS-fixed
custom health-check attribute that the provider-6 source no longer configured. That replacement
would also have updated the existing API Gateway integration and ECS gateway service. The plan was
rejected and never applied.

The source now ignores the unchanged legacy health-check block as a unit. This introduces no
deprecated argument or validation warning, preserves the current rollback ingress during the dark
deployment, and disappears when Cloud Map is deliberately removed after Lambda cutover.

## Corrected plan

`scripts/plan-development-gateway-lambda-dark.ps1` was run against the encrypted remote state and
live ECS/RDS configuration. It verified the exact account and region, stable one-of-one gateway and
worker services, immutable task images, versioned KMS-encrypted gateway artifact, full-object
checksum, source/digest metadata, extension architecture, and reserved concurrency two.

The guarded result was:

| Action | Count |
|---|---:|
| Create | 11 |
| Update | 0 |
| Delete | 0 |
| Replace | 0 |

The 11 creates are limited to:

- dormant HTTP API JWT authorizer;
- gateway Lambda execution role and least-privilege inline policy;
- versioned gateway Lambda function and development alias;
- exact-stage API Gateway invocation permission without an integration or route;
- Secrets Manager endpoint security group and single-AZ interface endpoint; and
- Lambda error, throttle, and p95-duration alarms.

The operator rejects any other create and every update, delete, or replacement. The sensitive plan
is ignored under the Terraform data directory and is not committed. The pre-merge diagnostic plan
SHA-256 was `9b54b861841c447fc6434788cdc449fe47e76d1af502e15fde02ccdc7ee8d667`.

## Exact-main apply and safe stop

After PR #65 merged, the operator ran from exact `main` commit
`2a12f6bca3f817c1d15ea5485a648b2218afeeb8`. The regenerated plan SHA-256 was
`ab422a6333a335c3749538588939e6eeda952f11c9cffbe9a94edfa2177b02cc`; it retained the reviewed
`11/0/0/0` boundary. The product owner explicitly authorized applying that exact saved plan.

AWS created the dormant authorizer, Lambda IAM role, inline policy, and endpoint security group,
then rejected creation of the Secrets Manager interface endpoint with `InvalidPolicyDocument`.
Terraform stopped and recorded those four creates in remote state. It did not create the endpoint,
Lambda function, alias, API invocation permission, or Lambda alarms.

Post-failure live checks proved:

- the gateway and workflow-worker ECS services remained active at desired/running/pending `1/1/0`;
- the only API route still used the existing `HTTP_PROXY` VPC Link and Cloud Map integration;
- no gateway Lambda function or Secrets Manager interface endpoint existed; and
- public API traffic therefore remained on the existing ECS path.

## Recovery correction

The rejected endpoint policy named the newly created execution-role principal directly. The
correction uses the standard wildcard endpoint principal plus an exact `aws:PrincipalArn`
condition for that role, while retaining the single `GetSecretValue` action and exact database-
secret resource. This avoids endpoint creation depending on immediate IAM principal resolution
without broadening the effective role, action, or resource boundary. See [AWS VPC endpoint policy
controls](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html).

The operator now has an explicit `-ResumePartialApply` mode. It requires every reviewed dark
resource to be either an unchanged object already in Terraform state or one of the remaining
reviewed creates, and it still rejects every unrelated create, update, delete, and replacement.
The unmerged diagnostic accounted for four existing reviewed resources and exactly seven remaining
creates with `0/0/0` updates/deletes/replacements. Its SHA-256 was
`f2f14298e3bc1f263e82e4febf15971ad94d4ed5b4025b55b3aed351ce166d28`; it was not applied.

## Claims and next gate

This proves the first exact apply failed closed without changing traffic and that the recovery
source can account for the partial state with only the seven remaining dark creates. It does not
authorize applying the recovery plan generated from unmerged source.

Next, merge the recovery correction, regenerate from exact `main`, inspect the seven-create and
four-existing boundary and new plan hash, and apply only that exact reviewed plan under fresh
explicit authorization.
