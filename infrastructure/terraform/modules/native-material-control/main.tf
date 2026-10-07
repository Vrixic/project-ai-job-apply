terraform {
  required_version = "= 1.16.2"
  required_providers { aws = { source = "hashicorp/aws", version = ">= 6.58, < 7.0" } }
}
variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Use the exact isolated account."
  }
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["development", "staging"], var.environment)
    error_message = "Use development or staging."
  }
}
variable "owner_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "control_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "recovery_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.recovery_enabled || var.control_enabled
    error_message = "Task-event recovery requires original control access."
  }
}
variable "new_launch_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.new_launch_enabled || (var.owner_enabled && var.control_enabled && var.recovery_enabled)
    error_message = "New tasks require owner, launcher and recovery."
  }
}
variable "release" {
  type = object({
    source_sha              = string
    release_id              = string
    artifact_bucket         = string
    artifacts               = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
    database_secret_arn     = string
    platform_kms_key_arn    = string
    extension_layer_arn     = string
    subnet_ids              = list(string)
    security_group_ids      = list(string)
    cluster_arn             = string
    task_definition_arn     = string
    image_repository        = string
    image_sha256            = string
    task_subnet_ids         = list(string)
    task_security_group_ids = list(string)
  })
  default = null
  validation {
    condition = var.release == null ? !(var.owner_enabled || var.control_enabled || var.recovery_enabled || var.new_launch_enabled) : (
      can(regex("^[a-f0-9]{40}$", var.release.source_sha)) && can(regex("^[a-z0-9]{1,12}$", var.release.release_id)) &&
      can(regex("^ai-job-apply-${var.environment}-artifacts-[a-z0-9-]+$", var.release.artifact_bucket)) &&
      toset(keys(var.release.artifacts)) == toset(["launch", "owner", "event"]) &&
      alltrue([for k, a in var.release.artifacts : can(regex("^[a-f0-9]{64}$", a.sha256)) && can(regex("^[A-Za-z0-9+/]{43}=$", a.base64sha256)) && a.version_id != "" && a.version_id != "null" && a.key == "lambda/documents/native-material/control/${var.release.source_sha}/${a.sha256}/${lookup({ launch = "native-material-launch-lambda", owner = "native-owner-rpc-lambda", event = "native-material-task-event-lambda" }, k, "invalid")}.zip"]) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${var.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", var.release.database_secret_arn)) &&
      can(regex("^arn:aws:kms:us-east-2:${var.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.release.platform_kms_key_arn)) &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.release.extension_layer_arn)) &&
      alltrue([for ids in [var.release.subnet_ids, var.release.task_subnet_ids] : length(ids) >= 1 && length(ids) <= 2 && length(distinct(ids)) == length(ids) && alltrue([for id in ids : can(regex("^subnet-[a-f0-9]{17}$", id))])]) &&
      alltrue([for ids in [var.release.security_group_ids, var.release.task_security_group_ids] : length(ids) >= 1 && length(ids) <= 2 && length(distinct(ids)) == length(ids) && alltrue([for id in ids : can(regex("^sg-[a-f0-9]{17}$", id))])]) &&
      can(regex("^arn:aws:ecs:us-east-2:${var.account_id}:cluster/ai-job-apply-${var.environment}[A-Za-z0-9_-]*$", var.release.cluster_arn)) &&
      can(regex("^arn:aws:ecs:us-east-2:${var.account_id}:task-definition/ai-job-apply-${var.environment}-native-material:[1-9][0-9]{0,8}$", var.release.task_definition_arn)) &&
      can(regex("^ai-job-apply/[a-z0-9]+(?:[._/-][a-z0-9]+)*$", var.release.image_repository)) && can(regex("^[a-f0-9]{64}$", var.release.image_sha256))
    )
    error_message = "Use exact immutable original control artifacts, task, private network and account bindings; null cannot activate."
  }
}
locals {
  deployed             = var.release != null
  actors               = local.deployed ? toset(["launch", "owner", "event"]) : toset([])
  names                = { for k in local.actors : k => "ai-job-apply-${var.environment}-material-${k}-${var.release.release_id}" }
  log_group            = "/ai-job-apply/${var.environment}/application"
  revision             = local.deployed ? element(reverse(split(":", var.release.task_definition_arn)), 0) : "0"
  task_role            = "arn:aws:iam::${var.account_id}:role/ai-job-apply-${var.environment}-native-material-r${local.revision}-task"
  execution_role       = "arn:aws:iam::${var.account_id}:role/ai-job-apply-${var.environment}-native-material-r${local.revision}-execution"
  deployment           = local.deployed ? { clusterArn = var.release.cluster_arn, taskDefinitionArn = var.release.task_definition_arn, containerName = "native-material" } : null
  launch_configuration = local.deployed ? merge(local.deployment, { image = "${var.account_id}.dkr.ecr.us-east-2.amazonaws.com/${var.release.image_repository}@sha256:${var.release.image_sha256}", taskRoleArn = local.task_role, executionRoleArn = local.execution_role, cpu = "256", memory = "512", subnets = var.release.task_subnet_ids, securityGroups = var.release.task_security_group_ids, assignPublicIp = var.task_public_ip_enabled ? "ENABLED" : "DISABLED" }) : null
  common               = { PLATFORM_AWS_ACCOUNT_ID = var.account_id }
}
data "aws_caller_identity" "current" { count = local.deployed ? 1 : 0 }
data "aws_region" "current" { count = local.deployed ? 1 : 0 }
resource "aws_iam_role" "runtime" {
  for_each             = local.actors
  name                 = local.names[each.key]
  permissions_boundary = each.key == "launch" ? "arn:aws:iam::${var.account_id}:policy/${local.names[each.key]}-boundary" : "arn:aws:iam::${var.account_id}:policy/ai-job-apply-${var.environment}-workload-boundary"
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "base" {
  for_each = local.actors
  name     = "native-control-base"
  role     = aws_iam_role.runtime[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${var.account_id}:log-group:${local.log_group}:*" },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.release.platform_kms_key_arn },
    { Effect = "Deny", Action = ["s3:*"], Resource = "*" }
    ], each.key == "event" ? [
    { Effect = "Deny", Action = ["secretsmanager:*", "ecs:*", "iam:PassRole", "rds-db:*"], Resource = "*" }
    ] : [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.release.database_secret_arn },
    { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*" }
  ], each.key == "owner" ? [{ Effect = "Deny", Action = ["ecs:*", "iam:PassRole", "lambda:InvokeFunction"], Resource = "*" }] : []) })
}
resource "aws_iam_role_policy" "launch" {
  count = local.deployed ? 1 : 0
  name  = "original-task-launch-and-observation"
  role  = aws_iam_role.runtime["launch"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecs:DescribeTaskDefinition"], Resource = "*" },
    { Effect = "Allow", Action = ["ecs:RunTask"], Resource = var.release.task_definition_arn, Condition = { ArnEquals = { "ecs:cluster" = var.release.cluster_arn }, Bool = { "ecs:enable-execute-command" = "false" } } },
    { Effect = "Allow", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:us-east-2:${var.account_id}:task/${element(reverse(split("/", var.release.cluster_arn)), 0)}/*", Condition = { ArnEquals = { "ecs:cluster" = var.release.cluster_arn } } },
    { Effect = "Allow", Action = ["iam:PassRole"], Resource = [local.task_role, local.execution_role], Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } },
    { Effect = "Deny", Action = ["ecs:StopTask", "ecs:ExecuteCommand", "lambda:InvokeFunction"], Resource = "*" }
  ] })
}
resource "aws_lambda_function" "launch" {
  count                          = local.deployed ? 1 : 0
  depends_on                     = [aws_iam_role_policy.base, aws_iam_role_policy.launch]
  function_name                  = local.names["launch"]
  role                           = aws_iam_role.runtime["launch"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts.launch.key
  s3_object_version              = var.release.artifacts.launch.version_id
  source_code_hash               = var.release.artifacts.launch.base64sha256
  kms_key_arn                    = var.release.platform_kms_key_arn
  environment { variables = merge(local.common, { NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED = tostring(var.control_enabled), NATIVE_MATERIAL_ROUTE_CONTROL_ENABLED = tostring(var.route_enabled), NATIVE_MATERIAL_ROUTE_CONFIGURATION_JSON = var.route == null ? "{}" : jsonencode({ hostedZoneId = var.route.hosted_zone_id, baseHost = var.route.base_host }), NATIVE_MATERIAL_NEW_LAUNCH_ENABLED = tostring(var.new_launch_enabled), NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON = jsonencode(local.launch_configuration), DATABASE_SECRET_ID = var.release.database_secret_arn }, { RELEASE_SHA = var.release.artifacts.launch.sha256 }) }
  layers = [var.release.extension_layer_arn]
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
      error_message = "Provider must match original release account/region."
    }
  }
}
resource "aws_lambda_function" "owner" {
  count                          = local.deployed ? 1 : 0
  depends_on                     = [aws_iam_role_policy.base, aws_iam_role_policy.launch]
  function_name                  = local.names["owner"]
  role                           = aws_iam_role.runtime["owner"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts.owner.key
  s3_object_version              = var.release.artifacts.owner.version_id
  source_code_hash               = var.release.artifacts.owner.base64sha256
  kms_key_arn                    = var.release.platform_kms_key_arn
  environment { variables = merge(local.common, { NATIVE_OWNER_RPC_ENABLED = tostring(var.owner_enabled), NATIVE_OWNER_RPC_DEPLOYMENT_JSON = jsonencode(merge(local.deployment, { taskRoleArn = local.task_role })), DATABASE_SECRET_ID = var.release.database_secret_arn }, { RELEASE_SHA = var.release.artifacts.owner.sha256 }) }
  layers = [var.release.extension_layer_arn]
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
      error_message = "Provider must match original release account/region."
    }
  }
}
resource "aws_lambda_function" "event" {
  count                          = local.deployed ? 1 : 0
  depends_on                     = [aws_iam_role_policy.base, aws_iam_role_policy.event]
  function_name                  = local.names["event"]
  role                           = aws_iam_role.runtime["event"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts.event.key
  s3_object_version              = var.release.artifacts.event.version_id
  source_code_hash               = var.release.artifacts.event.base64sha256
  kms_key_arn                    = var.release.platform_kms_key_arn
  environment { variables = merge(local.common, { NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED = tostring(var.recovery_enabled), NATIVE_MATERIAL_TASK_EVENT_CONFIGURATION_JSON = jsonencode(merge(local.deployment, { functionArn = aws_lambda_function.launch[0].qualified_arn })) }, { RELEASE_SHA = var.release.artifacts.event.sha256 }) }
  logging_config {
    log_format            = "JSON"
    application_log_level = "ERROR"
    system_log_level      = "WARN"
    log_group             = local.log_group
  }
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current[0].account_id == var.account_id && data.aws_region.current[0].region == "us-east-2"
      error_message = "Provider must match original release account/region."
    }
  }
}
resource "aws_iam_role_policy" "event" {
  count  = local.deployed ? 1 : 0
  name   = "recover-through-original-launcher"
  role   = aws_iam_role.runtime["event"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.launch[0].qualified_arn }] })
}
output "functions" { value = local.deployed ? { launch = aws_lambda_function.launch[0].qualified_arn, owner = aws_lambda_function.owner[0].qualified_arn, event = aws_lambda_function.event[0].qualified_arn } : {} }
output "role_arns" { value = { for k, r in aws_iam_role.runtime : k => r.arn } }
output "launch_configuration" { value = local.launch_configuration }

locals {
  event_dead_letter_arn = local.deployed ? "arn:aws:sqs:us-east-2:${var.account_id}:ai-job-apply-${var.environment}-material-events-${var.release.release_id}" : null
}
resource "aws_iam_role_policy" "event_failure" {
  count = local.deployed ? 1 : 0
  name  = "retain-original-event-failure"
  role  = aws_iam_role.runtime["event"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = local.event_dead_letter_arn },
    { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = var.release.platform_kms_key_arn }
  ] })
}
resource "aws_cloudwatch_event_rule" "task" {
  count         = local.deployed ? 1 : 0
  name          = local.names.event
  state         = var.recovery_enabled ? "ENABLED" : "DISABLED"
  event_pattern = jsonencode({ source = ["aws.ecs"], "detail-type" = ["ECS Task State Change"], account = [var.account_id], region = ["us-east-2"], detail = { clusterArn = [var.release.cluster_arn], taskDefinitionArn = [var.release.task_definition_arn], launchType = ["FARGATE"] } })
}
resource "aws_lambda_permission" "task" {
  count          = local.deployed ? 1 : 0
  statement_id   = "OriginalTaskChanges"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.event[0].function_name
  qualifier      = aws_lambda_function.event[0].version
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.task[0].arn
  source_account = var.account_id
}
resource "aws_lambda_function_event_invoke_config" "task" {
  count                        = local.deployed ? 1 : 0
  depends_on                   = [aws_iam_role_policy.event_failure]
  function_name                = aws_lambda_function.event[0].function_name
  qualifier                    = aws_lambda_function.event[0].version
  maximum_event_age_in_seconds = 21600
  maximum_retry_attempts       = 2
  destination_config {
    on_failure { destination = local.event_dead_letter_arn }
  }
}
resource "aws_cloudwatch_event_target" "task" {
  count      = local.deployed ? 1 : 0
  depends_on = [aws_lambda_permission.task, aws_lambda_function_event_invoke_config.task]
  rule       = aws_cloudwatch_event_rule.task[0].name
  target_id  = "original-task-event"
  arn        = aws_lambda_function.event[0].qualified_arn
  dead_letter_config { arn = local.event_dead_letter_arn }
  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 185
  }
}
output "task_event_rule_arn" { value = local.deployed ? aws_cloudwatch_event_rule.task[0].arn : null }
output "event_dead_letter_arn" { value = local.event_dead_letter_arn }

variable "task_public_ip_enabled" {
  description = "Original direct-TLS task networking; requires separately reviewed public subnet, ingress and routing. Does not activate launches."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.task_public_ip_enabled || var.release != null
    error_message = "Public task networking requires an original release."
  }
}

variable "route" {
  description = "Original material DNS configuration for private read-only route admission. No DNS resources are created."
  type        = object({ hosted_zone_id = string, base_host = string })
  default     = null
  validation {
    condition     = var.route == null ? true : (can(regex("^Z[A-Z0-9]{1,31}$", var.route.hosted_zone_id)) && length(var.route.base_host) <= 200 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$", var.route.base_host)))
    error_message = "Use the original reviewed hosted zone and lowercase base hostname."
  }
}
variable "route_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.route_enabled || (var.control_enabled && var.task_public_ip_enabled && var.route != null && var.release != null)
    error_message = "Route admission requires the original control, public task configuration and reviewed DNS binding."
  }
}
