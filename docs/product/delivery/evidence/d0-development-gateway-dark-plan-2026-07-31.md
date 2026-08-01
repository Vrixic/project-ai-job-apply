# D0-016 Development Gateway Dark-Plan Evidence — 2026-07-31

- Environment: development
- AWS account: `362544434697`
- AWS region: `us-east-2`
- Artifact source: `92e5b8f17a898c2970a4231c8a8b4e06c988be80`
- Artifact SHA-256: `f411b840aec7d631565ecab34e34a164680db49ad64cb2e2b691b3051214560d`
- Plan class: refresh-backed, create-only dark deployment
- Terraform apply: not performed
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

## Claims and next gate

This proves that the corrected source can produce a create-only development dark plan without
changing the existing API integration, ECS services, RDS, queues, buckets, KMS key, backups, cost
controls, or traffic. It does not authorize applying a plan generated from unmerged source.

Next, merge the plan guard and Cloud Map compatibility source, regenerate the plan from exact
`main`, inspect the same 11-create/zero-update/delete/replace boundary and new plan hash, and apply
only that exact reviewed plan under explicit authorization.
