# Native resume task release

Source-only, unattached module for the on-demand container described by Proposed ADR-040.
It creates no resources when `release = null`. A supplied exact release creates one Fargate
Linux/x86-64 task definition, two revision-qualified IAM roles and their two inline policies.
There is no ECS service, RunTask call, scheduler, network, listener, Lambda, secret value or
candidate data in this module. Development/staging do not instantiate it yet.

The task uses an immutable same-account image digest, Node entrypoint, UID/GID 65532, read-only
root, init, dropped Linux capabilities, zero core limits and only port 8443. It has no configured
logs, volumes, environment, secret injection, sidecars or health command. The existing owning
launcher supplies only the six scalar allocation/configuration overrides after SQL admission.
CPU/memory match the verified 256/512 launch envelope. Native application code remains responsible
for the original process deadline and authenticated source/read controls.

Task permissions allow only two exact numeric RPC function versions, one TLS secret version and
KMS decryption through Secrets Manager for that secret's encryption context. Explicit denials
cover S3, logging/tracing, ECS, remote-exec channels and database IAM access. The separate execution
role can pull only the exact image repository (ECR authorization requires its normal wildcard
resource). Both roles carry the existing environment workload permission boundary. The secret/key
and function names must also fit that boundary; this module does not broaden it.

ECS role trust is restricted by account and regional ECS source ARN. AWS does not support a
cluster-specific SourceArn for this trust relationship; reviewed PassRole/RunTask permissions,
original-task receiver checks and managed role-session acceptance remain necessary. See
[AWS task IAM role guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
and [Secrets Manager condition keys](https://docs.aws.amazon.com/service-authorization/latest/reference/list_secretsmanager.html).

The image configuration pins the original numeric task-definition revision. Supply that exact
ARN as `expected_task_definition_arn`; the resource postcondition refuses a different registration.
That check detects a mismatch after registration and does not undo the registration. Keep launch
disabled during release preparation and reconcile the exact image/task/role/function binding
before activation. Never change the image configuration merely to hide a revision race.

Environment composition must retain one module instance per original release while allocations
remain unresolved. Role names include the task revision; old definitions are not deregistered by
Terraform removal (`skip_destroy`). Retain the old roles, exact RPC versions and TLS secret version
until trusted drain/retirement evidence permits cleanup. Removing an instance is not a launch kill
switch and can remove its IAM policies/roles. Use the runtime's independent new-launch switch.

Local checks use Terraform 1.16.2 and a mocked AWS provider:

```powershell
terraform -chdir=infrastructure/terraform/modules/native-resume-task init -backend=false -lockfile=readonly
terraform -chdir=infrastructure/terraform/modules/native-resume-task validate
terraform -chdir=infrastructure/terraform/modules/native-resume-task test
```

Tests prove default absence, the task/IAM shape and refusal of foreign targets or unexpected
revision. They do not prove effective managed permissions, release approval, deployment,
network/TLS routing, task conformance or candidate/client/ATS acceptance. No public or production
authority is granted by these sources.
