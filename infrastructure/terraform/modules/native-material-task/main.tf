terraform {
  required_version = "= 1.16.2"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.58, < 7.0" }
  }
}

variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Use an exact AWS account ID."
  }
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["development", "staging"], var.environment)
    error_message = "Native task source supports isolated development or staging only."
  }
}
variable "release" {
  description = "Null creates no resources. Exact reviewed image/configuration and private recipients; never secret values."
  type = object({
    image_repository             = string
    image_sha256                 = string
    expected_task_definition_arn = string
    owner_function_arn           = string
    provider_secret_arn          = string
    provider_secret_version_id   = string
    provider_kms_key_arn         = string
    tls_secret_arn               = string
    tls_secret_version_id        = string
    tls_kms_key_arn              = string
  })
  default = null
  validation {
    condition = var.release == null ? true : (
      can(regex("^ai-job-apply/[a-z0-9]+(?:[._/-][a-z0-9]+)*$", var.release.image_repository)) &&
      can(regex("^[a-f0-9]{64}$", var.release.image_sha256)) &&
      can(regex("^arn:aws:ecs:us-east-2:${var.account_id}:task-definition/ai-job-apply-${var.environment}-native-material:[1-9][0-9]{0,8}$", var.release.expected_task_definition_arn)) &&
      alltrue([for arn in [var.release.owner_function_arn] :
      can(regex("^arn:aws:lambda:us-east-2:${var.account_id}:function:ai-job-apply-${var.environment}-[A-Za-z0-9_-]+:[1-9][0-9]{0,8}$", arn))]) &&
      var.release.provider_secret_arn != var.release.tls_secret_arn &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${var.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", var.release.provider_secret_arn)) &&
      can(regex("^[A-Za-z0-9-]{32,64}$", var.release.provider_secret_version_id)) &&
      can(regex("^arn:aws:kms:us-east-2:${var.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.release.provider_kms_key_arn)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${var.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", var.release.tls_secret_arn)) &&
      can(regex("^[A-Za-z0-9-]{32,64}$", var.release.tls_secret_version_id)) &&
      can(regex("^arn:aws:kms:us-east-2:${var.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.release.tls_kms_key_arn))
    )
    error_message = "Use an immutable same-account us-east-2 image, numeric original task/RPC versions, exact TLS secret/version and customer key."
  }
}
locals {
  enabled  = var.release != null
  name     = "ai-job-apply-${var.environment}-native-material"
  revision = local.enabled ? element(reverse(split(":", var.release.expected_task_definition_arn)), 0) : "0"
  boundary = "arn:aws:iam::${var.account_id}:policy/ai-job-apply-${var.environment}-workload-boundary"
  image    = local.enabled ? "${var.account_id}.dkr.ecr.us-east-2.amazonaws.com/${var.release.image_repository}@sha256:${var.release.image_sha256}" : null
  trust = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:ecs:us-east-2:${var.account_id}:*" }
      }
    }]
  })
  container = {
    name                   = "native-material"
    image                  = local.image
    essential              = true
    user                   = "65532:65532"
    readonlyRootFilesystem = true
    workingDirectory       = "/materials"
    entryPoint             = ["/usr/local/bin/node"]
    command                = ["native-material/main.mjs"]
    linuxParameters        = { initProcessEnabled = true, capabilities = { drop = ["ALL"] } }
    ulimits                = [{ name = "core", softLimit = 0, hardLimit = 0 }]
    portMappings           = [{ containerPort = 8443, hostPort = 8443, protocol = "tcp" }]
  }
}
data "aws_caller_identity" "current" { count = local.enabled ? 1 : 0 }
data "aws_region" "current" { count = local.enabled ? 1 : 0 }
resource "aws_iam_role" "execution" {
  count                = local.enabled ? 1 : 0
  name                 = "${local.name}-r${local.revision}-execution"
  assume_role_policy   = local.trust
  permissions_boundary = local.boundary
}
resource "aws_iam_role" "task" {
  count                = local.enabled ? 1 : 0
  name                 = "${local.name}-r${local.revision}-task"
  assume_role_policy   = local.trust
  permissions_boundary = local.boundary
}
resource "aws_iam_role_policy" "execution" {
  count = local.enabled ? 1 : 0
  name  = "pull-exact-repository"
  role  = aws_iam_role.execution[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      Resource = "arn:aws:ecr:us-east-2:${var.account_id}:repository/${var.release.image_repository}" }
    ]
  })
}
resource "aws_iam_role_policy" "task" {
  count = local.enabled ? 1 : 0
  name  = "original-material-rpc-and-secrets"
  role  = aws_iam_role.task[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "InvokePinnedOwners", Effect = "Allow", Action = ["lambda:InvokeFunction"],
      Resource = [var.release.owner_function_arn] },
      { Sid = "ReadPinnedTls", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.release.tls_secret_arn,
      Condition = { StringEquals = { "secretsmanager:VersionId" = var.release.tls_secret_version_id } } },
      { Sid = "DecryptOnlyTlsSecret", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.release.tls_kms_key_arn,
      Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.us-east-2.amazonaws.com", "kms:EncryptionContext:SecretARN" = var.release.tls_secret_arn } } },
      { Sid = "ReadPinnedProvider", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.release.provider_secret_arn,
      Condition = { StringEquals = { "secretsmanager:VersionId" = var.release.provider_secret_version_id } } },
      { Sid = "DecryptOnlyProviderSecret", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.release.provider_kms_key_arn,
      Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.us-east-2.amazonaws.com", "kms:EncryptionContext:SecretARN" = var.release.provider_secret_arn } } },
      { Sid = "NoPersistedContentOrRemoteExec", Effect = "Deny", Action = ["s3:*", "logs:*", "xray:*", "ssmmessages:*", "ecs:*", "rds-db:*"], Resource = "*" }
    ]
  })
}
resource "aws_ecs_task_definition" "material" {
  count                    = local.enabled ? 1 : 0
  family                   = local.name
  skip_destroy             = true
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution[0].arn
  task_role_arn            = aws_iam_role.task[0].arn
  container_definitions    = jsonencode([local.container])
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  depends_on = [aws_iam_role_policy.execution, aws_iam_role_policy.task]
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current[0].account_id == var.account_id && data.aws_region.current[0].region == "us-east-2"
      error_message = "Provider account and region must match the exact isolated target."
    }
    postcondition {
      condition     = self.arn == var.release.expected_task_definition_arn
      error_message = "Registered revision differs from the image-owned configuration. Keep launch disabled and reconcile the release; never retarget the image."
    }
  }
}
output "task_definition_arn" { value = local.enabled ? aws_ecs_task_definition.material[0].arn : null }
output "task_role_arn" { value = local.enabled ? aws_iam_role.task[0].arn : null }
output "execution_role_arn" { value = local.enabled ? aws_iam_role.execution[0].arn : null }
output "image" { value = local.image }
