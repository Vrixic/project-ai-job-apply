# Development Database Migration

Use this procedure to apply the reviewed profile foundation migration in the dedicated development
AWS account in `us-east-2`. The migration runs as a one-off ECS/Fargate task against private RDS.
It does not enable the gateway, worker, API Gateway, or Cloud Map.

The task uses a scanned immutable image digest, obtains `DATABASE_URL` directly from AWS Secrets
Manager, serializes concurrent migration attempts with a PostgreSQL advisory lock, records the
migration version and checksum, and verifies the expected tables before exiting.

## Preconditions

- Authenticate through the `ai-job-apply-development-admin` AWS SSO profile and verify the caller
  is the dedicated development account in `us-east-2`.
- Require a drift-free applications-disabled persistent environment.
- Use a gateway-compatible `linux/amd64` image whose ECR scan is `COMPLETE` with zero critical and
  zero high findings.
- Review the migration source and its integration-test result.
- Use Terraform `1.9.8`.

Do not run a migration from a mutable tag, a developer workstation process, or a task definition
that is not represented in Terraform.

## Provision only the migration task definition

From `infrastructure/terraform/environments/development`, initialize the existing encrypted remote
backend. Resolve the repository URL from Terraform output and append the approved platform-manifest
digest:

```powershell
$gatewayRepository = terraform output -raw gateway_repository_url
$env:TF_VAR_migration_image = "$gatewayRepository@sha256:APPROVED_LINUX_AMD64_DIGEST"

terraform plan `
  -input=false `
  -lock-timeout=5m `
  -var="deploy_applications=false" `
  -out=phase0-migration.tfplan
```

Review the saved plan. It may add a new revision of the migration task definition and root outputs.
It must keep `deploy_applications=false` and must not create API Gateway, Cloud Map, ECS services,
NAT, Redis, or an Application Load Balancer. Reject any replacement or deletion of persistent
resources.

Apply only that exact reviewed plan:

```powershell
terraform apply -input=false phase0-migration.tfplan
```

Delete the local saved plan after recording its SHA-256 and apply result. Terraform plan files can
contain sensitive values and must never be committed or attached to shared evidence.

## Run and verify the one-off task

Keep the same AWS SSO session and region:

```powershell
$clusterArn = terraform output -raw ecs_cluster_arn
$taskDefinitionArn = terraform output -raw migration_task_definition_arn
$subnetIds = @(terraform output -json migration_subnet_ids | ConvertFrom-Json)
$securityGroupId = terraform output -raw application_security_group_id
$networkConfiguration = "awsvpcConfiguration={subnets=[$($subnetIds -join ',')],securityGroups=[$securityGroupId],assignPublicIp=ENABLED}"

$taskArn = aws ecs run-task `
  --profile ai-job-apply-development-admin `
  --region us-east-2 `
  --cluster $clusterArn `
  --task-definition $taskDefinitionArn `
  --launch-type FARGATE `
  --count 1 `
  --network-configuration $networkConfiguration `
  --query "tasks[0].taskArn" `
  --output text

if (-not $taskArn -or $taskArn -eq "None") {
  throw "AWS did not start the migration task."
}

aws ecs wait tasks-stopped `
  --profile ai-job-apply-development-admin `
  --region us-east-2 `
  --cluster $clusterArn `
  --tasks $taskArn

$exitCode = aws ecs describe-tasks `
  --profile ai-job-apply-development-admin `
  --region us-east-2 `
  --cluster $clusterArn `
  --tasks $taskArn `
  --query "tasks[0].containers[?name=='database-migration'] | [0].exitCode" `
  --output text

if ($exitCode -ne "0") {
  throw "The migration task did not complete successfully."
}
```

Confirm the task stopped with exit code `0` and its encrypted CloudWatch log stream contains only:

```text
Database migration 0001_foundation applied and verified.
```

Do not copy database URLs, task environment variables, secret identifiers, account IDs, subnet
IDs, security-group IDs, or raw log payloads into shared evidence.

## Failure and retry

An unsuccessful task leaves long-running applications disabled. Inspect the sanitized stopped
reason and encrypted migration log, correct the cause, publish a new immutable image when code
changes, and run a newly reviewed task-definition revision. The transaction rolls back migration
statements on failure. Re-running the same approved image is safe: the journal checksum must match,
and an already-applied migration is verified without being reapplied.
