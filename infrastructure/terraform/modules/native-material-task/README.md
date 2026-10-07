# Native cover-letter task release

Registers the original Fargate task definition and bounded task/execution roles for
`Dockerfile.native-material`. A null release creates nothing. Development and staging expose
empty-by-default `native_material_task_releases`, keyed by original numeric revision (`r7`).
No service, RunTask, schedule, route or launch activation is created.

The task runs `native-material/main.mjs` as UID/GID 65532, with container init, read-only root,
dropped Linux capabilities, disabled core dumps and no logs, tracing, environment secrets,
mounts or content persistence. Its digest-pinned image owns the immutable runtime configuration;
only the launcher supplies the existing seven scalar allocation/original-work overrides.
CPU/memory are 256/512, matching the existing launcher validation contract; port is 8443.

The task role can invoke one exact numeric owner RPC and read two distinct pinned secret
versions: provider credentials and TLS. KMS decrypt is restricted to Secrets Manager and each
exact secret encryption context. It cannot read arbitrary secrets, persist content, log, trace,
call ECS, use remote exec or authenticate to the database. The execution role can pull only the
specified ECR repository, with the standard wildcard ECR authorization token permission.
Both roles use the existing environment workload boundary; no boundary expansion is introduced.

Input image configuration must bind the expected task-definition revision, container name
`native-material`, owner RPC, secret versions, deployment and identities. The registration
postcondition detects a revision mismatch after registration; it cannot undo the registration.
Keep launch disabled and reconcile a mismatch. Retain task revisions, original role policies,
owner function versions, secrets and keys until trusted original-work drain/retirement evidence.
Terraform skips deregistration of old definitions; deleting a module instance can still remove
its roles and policies and is not a safe kill switch.

The image, secret population/policies, owner and launcher Lambdas, task-event observation,
private endpoints/egress, cluster/subnets/security groups and authenticated DNS/TLS read route
remain separate prerequisites. Provider access remains consent-gated by the existing runtime.
This module neither calls a provider nor enables a live candidate journey.

Eight Terraform mock scenarios cover defaults, envelope/permissions, foreign account/environment,
registration mismatch, provider secret version, distinct secrets and numeric owner binding.
The generated mocked definition was also translated to the AWS SDK response shape and accepted
by the actual compiled launcher validator, with a foreign entrypoint rejected. This proves local
source compatibility, not registered ECS state, effective IAM, image execution or AWS acceptance.
