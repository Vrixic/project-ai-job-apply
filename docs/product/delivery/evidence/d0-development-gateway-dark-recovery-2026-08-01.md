# D0-016 Development Gateway Dark-Recovery Evidence — 2026-08-01

- Environment: development
- AWS region: `us-east-2`
- Merged recovery source: `923467a910d6cfccc1b7355e981f9881d27206e2`
- Artifact source: `92e5b8f17a898c2970a4231c8a8b4e06c988be80`
- API traffic change: none
- Gateway Lambda state: not created

## Endpoint-policy recovery

The exact post-merge recovery plan had SHA-256
`f2411276976326fb0389f06fb899421e20b854300e2ade3ef3e03db4e67ce30b`. It accounted for four
unchanged reviewed resources and seven remaining creates with zero updates, deletes, or
replacements. The product owner explicitly authorized that exact plan.

The command wrapper expired while Terraform was still creating the Secrets Manager interface
endpoint. The Terraform child continued, AWS made the endpoint available, and remote state recorded
it. The endpoint has private DNS enabled, one private subnet, the dedicated endpoint security
group, and the corrected policy: wildcard endpoint principal constrained by the exact Lambda role
ARN, `secretsmanager:GetSecretValue`, and the exact database secret. Terraform did not proceed to
create the Lambda function.

A second guarded plan had SHA-256
`0cd92e72988966e22f93b856c8b4a488947e984413e74c2eaf536d82b1f3fd6d`. It accounted for five
existing reviewed resources and only the six missing Lambda/function-alias/permission/alarm
creates. The product owner explicitly authorized that exact plan.

AWS rejected `CreateFunction` after 5 minutes 10 seconds because the Lambda execution role's
permissions boundary did not permit `ec2:CreateNetworkInterface`. The role's inline policy already
requested most ENI lifecycle actions, but the older shared boundary was designed only for ECS. No
Lambda, alias, permission, or alarm was created.

After both safe stops, live checks proved the gateway and workflow-worker ECS services remained
active at desired/running/pending `1/1/0`, the only public API route still targeted the existing
`HTTP_PROXY` VPC Link and Cloud Map integration, and no traffic moved to Lambda.

## Corrective source and plan boundaries

The correction follows the current AWS Lambda VPC execution policy action set:

- the workload permissions boundary adds only the six ENI lifecycle/read actions;
- the Lambda inline policy adds its missing `ec2:DescribeSubnets` action;
- the environment-scoped GitHub deployment policy can manage only this environment's project
  Lambda functions and the official Parameters and Secrets extension layer;
- `iam:PassRole` remains restricted to project workload-role names and only ECS tasks or Lambda;
  and
- the legacy IAM managed-policy description remains unchanged because AWS treats description
  changes as replacement. A diagnostic replacement plan was rejected and never applied.

The corrected bootstrap diagnostic is required to contain only three in-place IAM policy updates
with zero creates, deletes, or replacements. The corrected platform diagnostic is guarded to allow
only the six remaining reviewed creates plus the exact in-place addition of
`ec2:DescribeSubnets`; every other update and every delete or replacement remains denied.

The unmerged refresh-backed diagnostics passed those boundaries:

| Plan | SHA-256 | Create | Update | Delete | Replace |
|---|---|---:|---:|---:|---:|
| Development bootstrap | `7d1ed8428a52fea61b73e31ea3acba2e34fd59f7847d0ffb84e442455fd723d7` | 0 | 3 | 0 | 0 |
| Development platform | `b71f0bf36b8e213e32d3ba0973c5b31d27e45d19d4caf8ad28ebf8832d2100ba` | 6 | 1 | 0 | 0 |

The bootstrap updates are limited to the workload boundary, GitHub deployment boundary, and its
matching inline policy. AWS IAM Access Analyzer returned zero findings for both generated identity
policies. The platform update is limited to the existing gateway Lambda inline policy; its six
creates remain the function, immutable alias, exact-stage permission, and three alarms. Neither
unmerged diagnostic was applied.

## State-encryption discrepancy

A read-only check found that the active `bootstrap.tfstate` and `platform.tfstate` objects reported
SSE-S3 even though their private versioned bucket defaults to the environment's customer-managed
KMS key. The state is encrypted, but this contradicts prior CMK-specific evidence. Terraform's S3
backend was initialized with `encrypt=true` but without `kms_key_id`; in that configuration the
backend wrote these state objects using SSE-S3 despite the bucket default.

The correction resolves and validates the exact bucket-default KMS key and supplies it to backend
initialization in the guarded local operator and GitHub Terraform workflow. No evidence may claim
customer-managed KMS state-object encryption until fresh object metadata proves `aws:kms` after an
authorized exact-plan apply.

## Next gate

Merge the correction, regenerate the independent development bootstrap and platform plans from
exact `main`, and review their hashes and action allowlists. Apply the bootstrap plan first, verify
the boundary and GitHub role plus KMS-encrypted bootstrap state object, then regenerate and apply
the platform plan. Only after the Lambda is active may function-level denial, secret retrieval,
logging, alarm, no-drift, and unchanged-route conformance begin.
