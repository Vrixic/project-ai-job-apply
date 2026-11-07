terraform {
  required_version = "= 1.16.2"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 6.58, < 7.0" } }
}
variable "account_id" {
  type     = string
  nullable = false
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Use the exact target account."
  }
}
variable "environment" {
  type     = string
  nullable = false
  validation {
    condition     = contains(["development", "staging"], var.environment)
    error_message = "Use an isolated development or staging environment."
  }
}
variable "enabled" {
  description = "Separate private RPC runtime gate; deployment alone leaves both handlers off."
  type        = bool
  default     = false
  nullable    = false
}
variable "original_pdf_enabled" {
  description = "ADR-058: also let the source RPC read the candidate's own retained PDF (quarantine/<documentId>/source) so the generated resume can keep its design. Off by default; the read stays one exact, version-bound object pattern."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.original_pdf_enabled || var.release != null
    error_message = "Reading the original PDF requires a reviewed release."
  }
}
variable "release" {
  description = "Reviewed immutable artifacts and existing private infrastructure identifiers. No secret values."
  type = object({
    source_sha           = string
    artifact_bucket      = string
    artifacts            = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
    cluster_arn          = string
    task_definition_arn  = string
    database_secret_arn  = string
    platform_kms_key_arn = string
    normalized_bucket    = string
    extension_layer_arn  = string
    subnet_ids           = list(string)
    security_group_ids   = list(string)
  })
  default = null
  validation {
    condition = var.release == null ? !var.enabled : (
      can(regex("^[a-f0-9]{40}$", var.release.source_sha)) &&
      alltrue([for name in [var.release.artifact_bucket, var.release.normalized_bucket] : can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", name))]) &&
      toset(keys(var.release.artifacts)) == toset(["owner", "source"]) &&
      alltrue([for kind, a in var.release.artifacts :
        can(regex("^[a-f0-9]{64}$", a.sha256)) && can(regex("^[A-Za-z0-9+/]{43}=$", a.base64sha256)) &&
        length(a.version_id) > 0 && a.version_id != "null" && length(a.version_id) <= 1024 &&
        a.key == "lambda/documents/native-resume/${var.release.source_sha}/${a.sha256}/native-resume-${kind}-rpc-lambda.zip"
      ]) &&
      can(regex("^arn:aws:ecs:us-east-2:${var.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", var.release.cluster_arn)) &&
      can(regex("^arn:aws:ecs:us-east-2:${var.account_id}:task-definition/ai-job-apply-${var.environment}-native-resume:[1-9][0-9]{0,8}$", var.release.task_definition_arn)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${var.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", var.release.database_secret_arn)) &&
      can(regex("^arn:aws:kms:us-east-2:${var.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.release.platform_kms_key_arn)) &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.release.extension_layer_arn)) &&
      length(var.release.subnet_ids) >= 2 && length(var.release.subnet_ids) <= 3 && length(distinct(var.release.subnet_ids)) == length(var.release.subnet_ids) &&
      alltrue([for id in var.release.subnet_ids : can(regex("^subnet-[a-f0-9]{17}$", id))]) &&
      length(var.release.security_group_ids) >= 1 && length(var.release.security_group_ids) <= 2 &&
      alltrue([for id in var.release.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))])
    )
    error_message = "Use the complete source-bound two-artifact receipt, same-account original task/secret/key and exact private network/layer identifiers; activation requires a release."
  }
}
locals {
  deployed  = var.release != null
  actors    = local.deployed ? toset(["owner", "source"]) : toset([])
  revision  = local.deployed ? element(reverse(split(":", var.release.task_definition_arn)), 0) : "0"
  names     = { for kind in ["owner", "source"] : kind => "ai-job-apply-${var.environment}-resume-${kind}-r${local.revision}" }
  boundary  = "arn:aws:iam::${var.account_id}:policy/ai-job-apply-${var.environment}-workload-boundary"
  log_group = "/ai-job-apply/${var.environment}/application"
  # The retained original upload, one exact key shape per document; versions are bound by the caller.
  original_pdf_resource = local.deployed ? "arn:aws:s3:::${var.release.normalized_bucket}/quarantine/*/source" : ""
  deployment = local.deployed ? {
    clusterArn        = var.release.cluster_arn
    taskDefinitionArn = var.release.task_definition_arn
    taskRoleArn       = "arn:aws:iam::${var.account_id}:role/ai-job-apply-${var.environment}-native-resume-r${local.revision}-task"
    containerName     = "native-resume"
  } : null
}
data "aws_caller_identity" "current" { count = local.deployed ? 1 : 0 }
data "aws_region" "current" { count = local.deployed ? 1 : 0 }
resource "aws_iam_role" "rpc" {
  for_each             = local.actors
  name                 = local.names[each.key]
  permissions_boundary = local.boundary
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "rpc" {
  for_each = local.actors
  name     = "owning-metadata-runtime"
  role     = aws_iam_role.rpc[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Sid = "ExistingApplicationLogs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${var.account_id}:log-group:${local.log_group}:*" },
    { Sid = "PrivateVpcInterfaces", Effect = "Allow", Action = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    { Sid = "OwningDatabaseSecret", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.release.database_secret_arn },
    { Sid = "DecryptOwningConfiguration", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.release.platform_kms_key_arn },
    { Sid = "NoLaunchProviderOrObjectWrites", Effect = "Deny", Action = ["ecs:*", "iam:PassRole", "lambda:InvokeFunction", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "secretsmanager:PutSecretValue"], Resource = "*" }
    ], each.key == "source" ? [
    { Sid = "RetainedNormalizedVersionsOnly", Effect = "Allow", Action = ["s3:GetObjectVersion"], Resource = "arn:aws:s3:::${var.release.normalized_bucket}/normalized/*/*/*/resume.json" }
    ] : [], each.key == "source" && !var.original_pdf_enabled ? [
    { Sid = "NoOtherObjectReads", Effect = "Deny", Action = ["s3:GetObject", "s3:GetObjectVersion"], NotResource = "arn:aws:s3:::${var.release.normalized_bucket}/normalized/*/*/*/resume.json" }
    ] : [], each.key == "source" && var.original_pdf_enabled ? [
    { Sid = "NoOtherObjectReads", Effect = "Deny", Action = ["s3:GetObject", "s3:GetObjectVersion"], NotResource = ["arn:aws:s3:::${var.release.normalized_bucket}/normalized/*/*/*/resume.json", local.original_pdf_resource] }
    ] : [], each.key == "source" && var.original_pdf_enabled ? [
    { Sid = "RetainedOriginalPdfVersionsOnly", Effect = "Allow", Action = ["s3:GetObjectVersion", "s3:GetObjectVersionTagging"], Resource = local.original_pdf_resource }
    ] : [], each.key == "owner" ? [
    { Sid = "NoObjectCapability", Effect = "Deny", Action = ["s3:*"], Resource = "*" }
  ] : []) })
}
resource "aws_lambda_function" "rpc" {
  for_each                       = local.actors
  function_name                  = local.names[each.key]
  role                           = aws_iam_role.rpc[each.key].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 2
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts[each.key].key
  s3_object_version              = var.release.artifacts[each.key].version_id
  source_code_hash               = var.release.artifacts[each.key].base64sha256
  layers                         = [var.release.extension_layer_arn]
  kms_key_arn                    = var.release.platform_kms_key_arn
  environment {
    variables = merge({
      NODE_ENV                               = "production"
      RELEASE_SHA                            = var.release.artifacts[each.key].sha256
      PLATFORM_AWS_ACCOUNT_ID                = var.account_id
      DATABASE_SECRET_ID                     = var.release.database_secret_arn
      PARAMETERS_SECRETS_EXTENSION_LOG_LEVEL = "ERROR"
      }, each.key == "owner" ? {
      NATIVE_RESUME_OWNER_RPC_ENABLED         = tostring(var.enabled)
      NATIVE_RESUME_OWNER_RPC_DEPLOYMENT_JSON = jsonencode(local.deployment)
      } : {
      NATIVE_RESUME_SOURCE_RPC_ENABLED         = tostring(var.enabled)
      NATIVE_RESUME_SOURCE_RPC_DEPLOYMENT_JSON = jsonencode(local.deployment)
      NATIVE_RESUME_SOURCE_BUCKET              = var.release.normalized_bucket
      NATIVE_RESUME_SOURCE_KMS_KEY_ARN         = var.release.platform_kms_key_arn
      }, each.key == "source" && var.original_pdf_enabled ? {
      NATIVE_RESUME_ORIGINAL_PDF_ENABLED = "true"
    } : {})
  }
  vpc_config {
    subnet_ids         = var.release.subnet_ids
    security_group_ids = var.release.security_group_ids
  }
  logging_config {
    log_format            = "JSON"
    application_log_level = "ERROR"
    system_log_level      = "WARN"
    log_group             = local.log_group
  }
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current[0].account_id == var.account_id && data.aws_region.current[0].region == "us-east-2"
      error_message = "Provider account/region differs from reviewed release target."
    }
  }
  depends_on = [aws_iam_role_policy.rpc]
}
output "qualified_function_arns" { value = { for kind, fn in aws_lambda_function.rpc : kind => fn.qualified_arn } }
output "task_binding" { value = local.deployment }
