# D0-016 Development Gateway Dark-Recovery Evidence — 2026-08-01

- Environment: development
- AWS region: `us-east-2`
- Initial merged recovery source: `923467a910d6cfccc1b7355e981f9881d27206e2`
- Merged IAM/KMS correction source: `76e16384355224d8ba6873f8b6c94ab062719690`
- Artifact source: `92e5b8f17a898c2970a4231c8a8b4e06c988be80`
- API traffic change: none
- Gateway Lambda state: active, tracked, complete dark deployment; still unrouted

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

## Merged correction and quota-limited completion

PR #67 merged as `76e16384355224d8ba6873f8b6c94ab062719690`. The exact merged bootstrap
plan `c01d85a86201fe6416d5fa6882f2cd411ebcb3230e0cc99429ba555a1cb1b055` applied with zero
creates, three in-place IAM updates, and zero destroys. Live policy inspection and IAM Access
Analyzer passed with zero findings. `bootstrap.tfstate` was rewritten with the bucket's
customer-managed KMS key and a refresh-backed post-apply plan returned no drift.

The independently regenerated platform plan
`b012e05ce86cb476d95369927f326672ebb7d93e4ff31184455bdaefb3afd41f` contained the six
missing dark creates plus the exact Lambda-role policy update, with no delete, replacement, or API
traffic change. Its exact apply updated the policy and created an active, tracked `$LATEST` Lambda,
then AWS rejected reserved concurrency `2`: the new account's effective regional concurrency was
`10`, and no units could be reserved while retaining AWS's required unreserved pool. Terraform
stopped before creating the alias, API permission, or three alarms. The function remained dark,
ECS gateway/worker remained at desired/running/pending `1/1/0`, and the sole API integration
remained `HTTP_PROXY`. `platform.tfstate` was rewritten with customer-managed KMS encryption.

AWS would not accept the requested value `20` because its Service Quotas API treats `1000` as the
standard default. The product owner authorized a `1001` request. That request remains
`CASE_OPENED`, but AWS restored the effective account limit to `1000`, which is sufficient for the
reviewed function ceiling while retaining the standard unreserved pool. A quota is a capacity
limit, not provisioned concurrency; no idle Lambda concurrency charge was enabled.

## Taint and pinned-layer recovery

The failed create marked the tracked function tainted. A refresh-backed diagnostic
`d6c9dbb7594be7f40d3013d96dc3019d6c86bc9878b8c7ddecc7e98f637ab098` proposed replacing
that function plus five creates, so the operator rejected it. Before state recovery, live checks
proved the exact artifact checksum, Node.js 24 handler, active/successful function state, no alias,
no resource policy, no Lambda alarms, no API route, and an effective concurrency limit of `1000`.

The product owner explicitly authorized taint recovery. The current KMS-encrypted, versioned state
object (`brMTjLdZI90_qRJlD4GPgaG.2v3vHG22`) was retained as the recovery checkpoint. Terraform
cleared only `module.platform.aws_lambda_function.gateway[0]`'s taint marker, writing a new
KMS-encrypted state version (`W_y_IaZ6eGClk9LDslXNfFwzwH89b_si`) without changing AWS resources
or API traffic.

The first post-untaint plan correctly removed replacement, but the operator rejected it because
AWS's moving extension parameter had advanced from the deployed and reviewed layer `114` to `115`.
The recovery operator now requires an explicit official pinned layer, proves that layer is already
attached to the healthy dark function, verifies sufficient effective account concurrency, and
allows only the exact reserved-concurrency transition from `-1` to `2`.

The unmerged guarded diagnostic has SHA-256
`8c37cdc54083be3f94da7f7e2c35198b20c418c987175c89de45faa2cf2d14a9`. It pins official
layer `114` and contains exactly five creates (alias, API permission, and three alarms), one
in-place function concurrency update, zero deletes, zero replacements, and no API traffic change.
It is diagnostic evidence only and was not applied.

## Completed dark deployment and conformance

PR #68 merged as `42aede2e35494de9e138e82905f70ee0e9ac401f`. The exact regenerated recovery
plan `a09e5bcfdcc25ada0074ba5c729c02b386a41d901b06a9747424f29a8e4c49d2` passed the same
five-create/one-update boundary and was explicitly authorized. Its apply completed with five
creates, one in-place update, and zero destroys.

Live verification proved:

- the function is `Active` with a successful last update and reserved concurrency exactly `2`;
- alias `development` targets immutable published version `1`, not `$LATEST`;
- the artifact checksum and already reviewed official extension layer `114` match;
- the Lambda resource policy permits only API Gateway from the exact development API `$default`
  stage;
- the duration, error, and throttle alarms exist with one enabled notification action each and
  reached `OK` after dark invocations;
- `platform.tfstate` remains customer-managed-KMS encrypted with bucket keys;
- both ECS rollback services remain desired/running/pending `1/1/0`;
- the sole API route remains unauthenticated `$default` on the existing `HTTP_PROXY` integration,
  so no public traffic reaches Lambda; and
- JSON application logging, INFO application level, WARN system level, active tracing, and recent
  CloudWatch log events are present.

Two direct invocations targeted alias `development` and executed immutable version `1`. Public
`/health/ready` returned `200`, proving managed-secret retrieval and PostgreSQL readiness. A
protected `/v1/me` event without API Gateway authorizer context returned `401` with
`authentication_required`, proving fail-closed function-level denial before application dispatch.

The recovery operator was extended locally with completed-dark verification: it requires the
deployed official layer pin and exact concurrency, then accepts only a refresh-backed zero-change
plan. That unmerged diagnostic accounted for all 11 reviewed resources with zero creates, updates,
deletes, or replacements and no traffic change. Its SHA-256 is
`c81b98b373bb0e24e923a256d0847d052137ebf0a68f085624c0746502c08729` and it was not applied.

## Next gate

Merge the completed-dark zero-drift verification mode and evidence, then rerun it from exact
`main`. Continue the remaining development acceptance matrix—authenticated owner-isolated reads
and writes, alarm delivery drill, rollback proof, and bounded cutover review—without moving public
traffic or retiring ECS early.
