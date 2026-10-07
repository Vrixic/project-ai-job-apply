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
  description = "Private control, durable and dispatcher runtime gate; deployment alone remains off."
  type        = bool
  default     = false
  nullable    = false
}
variable "release" {
  description = "Reviewed immutable artifacts and existing private infrastructure identifiers. No secret values."
  type = object({
    source_sha               = string
    observer_dead_letter_arn = string
    artifact_bucket          = string
    artifacts                = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
    cluster_arn              = string
    task_definition_arn      = string
    database_secret_arn      = string
    platform_kms_key_arn     = string
    image                    = string
    task_subnet_ids          = list(string)
    task_assign_public_ip    = string
    task_security_group_ids  = list(string)
    extension_layer_arn      = string
    subnet_ids               = list(string)
    security_group_ids       = list(string)
  })
  default = null
  validation {
    condition = var.release == null ? !var.enabled : (
      can(regex("^[a-f0-9]{40}$", var.release.source_sha)) &&
      can(regex("^arn:aws:sqs:us-east-2:${var.account_id}:ai-job-apply-${var.environment}-[A-Za-z0-9_-]+$", var.release.observer_dead_letter_arn)) &&
      alltrue([for name in [var.release.artifact_bucket] : can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", name))]) &&
      toset(keys(var.release.artifacts)) == toset(["control", "durable", "dispatch", "observer"]) &&
      alltrue([for kind, a in var.release.artifacts :
        can(regex("^[a-f0-9]{64}$", a.sha256)) && can(regex("^[A-Za-z0-9+/]{43}=$", a.base64sha256)) &&
        length(a.version_id) > 0 && a.version_id != "null" && length(a.version_id) <= 1024 &&
        a.key == "lambda/documents/native-resume/${var.release.source_sha}/${a.sha256}/${lookup({ control = "native-resume-preparation-control-lambda", durable = "native-resume-preparation-durable-lambda", dispatch = "native-resume-request-dispatch-lambda", observer = "native-resume-task-observer-lambda" }, kind, "invalid")}.zip"
      ]) &&
      can(regex("^arn:aws:ecs:us-east-2:${var.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", var.release.cluster_arn)) &&
      can(regex("^arn:aws:ecs:us-east-2:${var.account_id}:task-definition/ai-job-apply-${var.environment}-native-resume:[1-9][0-9]{0,8}$", var.release.task_definition_arn)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${var.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", var.release.database_secret_arn)) &&
      can(regex("^arn:aws:kms:us-east-2:${var.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.release.platform_kms_key_arn)) &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.release.extension_layer_arn)) &&
      can(regex("^${var.account_id}[.]dkr[.]ecr[.]us-east-2[.]amazonaws[.]com/ai-job-apply/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$", var.release.image)) &&
      contains(["ENABLED", "DISABLED"], var.release.task_assign_public_ip) &&
      alltrue([for ids in [var.release.task_subnet_ids, var.release.task_security_group_ids] : length(ids) >= 1 && length(ids) <= 4 && length(distinct(ids)) == length(ids)]) &&
      alltrue([for id in var.release.task_subnet_ids : can(regex("^subnet-[a-f0-9]{17}$", id))]) &&
      alltrue([for id in var.release.task_security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))]) &&
      length(var.release.subnet_ids) >= 2 && length(var.release.subnet_ids) <= 3 && length(distinct(var.release.subnet_ids)) == length(var.release.subnet_ids) &&
      alltrue([for id in var.release.subnet_ids : can(regex("^subnet-[a-f0-9]{17}$", id))]) &&
      length(var.release.security_group_ids) >= 1 && length(var.release.security_group_ids) <= 2 &&
      alltrue([for id in var.release.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))])
    )
    error_message = "Use the complete source-bound four-artifact receipt, same-account original task/secret/key and exact private network/layer identifiers; activation requires a release."
  }
}
variable "new_launch_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.new_launch_enabled || var.enabled
    error_message = "New launches require the private runtime gate."
  }
}
variable "schedule_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.schedule_enabled || (var.enabled && var.new_launch_enabled)
    error_message = "Scheduled dispatch requires runtime and new-launch activation."
  }
}
locals {
  deployed       = var.release != null
  revision       = local.deployed ? element(reverse(split(":", var.release.task_definition_arn)), 0) : "0"
  names          = { for kind in ["control", "durable", "dispatch", "observer"] : kind => "ai-job-apply-${var.environment}-resume-${kind}-r${local.revision}" }
  boundary       = "arn:aws:iam::${var.account_id}:policy/ai-job-apply-${var.environment}-workload-boundary"
  log_group      = "/ai-job-apply/${var.environment}/application"
  actors         = local.deployed ? toset(["control", "durable", "dispatch", "observer"]) : toset([])
  task_role      = "arn:aws:iam::${var.account_id}:role/ai-job-apply-${var.environment}-native-resume-r${local.revision}-task"
  execution_role = "arn:aws:iam::${var.account_id}:role/ai-job-apply-${var.environment}-native-resume-r${local.revision}-execution"
  durable_arn    = "arn:aws:lambda:us-east-2:${var.account_id}:function:${local.names.durable}"
  deployment     = local.deployed ? { clusterArn = var.release.cluster_arn, taskDefinitionArn = var.release.task_definition_arn, containerName = "native-resume" } : null
  launch = local.deployed ? merge(local.deployment, {
    image          = var.release.image, taskRoleArn = local.task_role, executionRoleArn = local.execution_role,
    cpu            = "256", memory = "512", subnets = sort(var.release.task_subnet_ids),
    securityGroups = sort(var.release.task_security_group_ids), assignPublicIp = var.release.task_assign_public_ip
  }) : null
  common_environment = local.deployed ? {
    NODE_ENV           = "production", PLATFORM_AWS_ACCOUNT_ID = var.account_id,
    DATABASE_SECRET_ID = var.release.database_secret_arn, PARAMETERS_SECRETS_EXTENSION_LOG_LEVEL = "ERROR"
  } : {}
  durable_environment = local.deployed ? {
    NODE_ENV                                       = "production", PLATFORM_AWS_ACCOUNT_ID = var.account_id,
    RELEASE_SHA                                    = var.release.artifacts.durable.sha256,
    NATIVE_RESUME_PREPARATION_DURABLE_ENABLED      = tostring(var.enabled),
    NATIVE_RESUME_PREPARATION_CONTROL_FUNCTION_ARN = aws_lambda_function.control[0].qualified_arn
  } : {}
}
data "aws_caller_identity" "current" { count = local.deployed ? 1 : 0 }
data "aws_region" "current" { count = local.deployed ? 1 : 0 }
resource "aws_iam_role" "runtime" {
  for_each             = local.actors
  name                 = local.names[each.key]
  permissions_boundary = contains(["control", "observer"], each.key) ? "arn:aws:iam::${var.account_id}:policy/${local.names[each.key]}-boundary" : local.boundary
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "runtime" {
  for_each = local.actors
  name     = "private-resume-preparation"
  role     = aws_iam_role.runtime[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Sid = "ExistingLogs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${var.account_id}:log-group:${local.log_group}:*" },
    { Sid = "ConfigurationKey", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.release.platform_kms_key_arn },
    { Sid = "NoContentOrRemoteExec", Effect = "Deny", Action = ["s3:*", "ssmmessages:*", "ecs:ExecuteCommand", "ecs:StopTask", "secretsmanager:PutSecretValue"], Resource = "*" }
    ], each.key != "durable" ? [
    { Sid = "OwningDatabaseSecret", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.release.database_secret_arn },
    { Sid = "PrivateVpc", Effect = "Allow", Action = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"], Resource = "*" }
  ] : []) })
}
resource "aws_iam_role_policy" "control" {
  count = local.deployed ? 1 : 0
  name  = "exact-control-capability"
  role  = aws_iam_role.runtime["control"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "ReadTaskDefinition", Effect = "Allow", Action = ["ecs:DescribeTaskDefinition"], Resource = "*" },
    { Sid = "LaunchExactOriginal", Effect = "Allow", Action = ["ecs:RunTask"], Resource = var.release.task_definition_arn, Condition = { ArnEquals = { "ecs:cluster" = var.release.cluster_arn }, Bool = { "ecs:enable-execute-command" = "false" } } },
    { Sid = "RecoverOriginalTask", Effect = "Allow", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:us-east-2:${var.account_id}:task/${element(reverse(split("/", var.release.cluster_arn)), 0)}/*", Condition = { ArnEquals = { "ecs:cluster" = var.release.cluster_arn } } },
    { Sid = "PassOriginalRoles", Effect = "Allow", Action = ["iam:PassRole"], Resource = [local.task_role, local.execution_role], Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
  ] })
}
resource "aws_iam_role_policy" "durable" {
  count = local.deployed ? 1 : 0
  name  = "exact-durable-capability"
  role  = aws_iam_role.runtime["durable"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "OwnedCheckpoints", Effect = "Allow", Action = ["lambda:CheckpointDurableExecution", "lambda:GetDurableExecutionState"], Resource = "${local.durable_arn}:*" },
    { Sid = "ExactOwnerControl", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.control[0].qualified_arn },
    { Sid = "EncryptedCheckpoints", Effect = "Allow", Action = ["kms:GenerateDataKey"], Resource = var.release.platform_kms_key_arn },
    { Sid = "NoDatabaseOrLaunch", Effect = "Deny", Action = ["secretsmanager:*", "rds-db:*", "ecs:*", "iam:PassRole"], Resource = "*" }
  ] })
}
resource "aws_iam_role_policy" "dispatch" {
  count = local.deployed ? 1 : 0
  name  = "exact-dispatch-capability"
  role  = aws_iam_role.runtime["dispatch"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "ExactWorkflow", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"] },
    { Sid = "NoLaunch", Effect = "Deny", Action = ["ecs:*", "iam:PassRole"], Resource = "*" }
  ] })
}

resource "aws_lambda_function" "control" {
  count                          = local.deployed ? 1 : 0
  depends_on                     = [aws_iam_role_policy.runtime, aws_iam_role_policy.control]
  function_name                  = local.names.control
  role                           = aws_iam_role.runtime["control"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 2
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts.control.key
  s3_object_version              = var.release.artifacts.control.version_id
  source_code_hash               = var.release.artifacts.control.base64sha256
  layers                         = [var.release.extension_layer_arn]
  kms_key_arn                    = var.release.platform_kms_key_arn
  environment {
    variables = merge(local.common_environment, {
      RELEASE_SHA                               = var.release.artifacts.control.sha256,
      NATIVE_RESUME_PREPARATION_CONTROL_ENABLED = tostring(var.enabled),
      RESTRICTED_PACKET_PROTECTION_ENABLED      = tostring(var.enabled),
      NATIVE_RESUME_NEW_LAUNCH_ENABLED          = tostring(var.new_launch_enabled),
      NATIVE_RESUME_LAUNCH_CONFIGURATION_JSON   = jsonencode(local.launch)
    })
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
      error_message = "Provider account/region differs from the reviewed target."
    }
  }
}
# Match the existing platform's Terraform-owned CloudFormation pattern for CMK durable state.
resource "aws_cloudformation_stack" "durable" {
  count      = local.deployed ? 1 : 0
  name       = local.names.durable
  depends_on = [aws_iam_role_policy.runtime, aws_iam_role_policy.durable]
  on_failure = "DELETE"
  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09",
    Resources = {
      DurableFunction = {
        Type = "AWS::Lambda::Function",
        Properties = {
          FunctionName  = local.names.durable, Runtime = "nodejs24.x", Architectures = ["x86_64"],
          Handler       = "index.handler", Role = aws_iam_role.runtime["durable"].arn,
          MemorySize    = 512, Timeout = 30, ReservedConcurrentExecutions = 2,
          Code          = { S3Bucket = var.release.artifact_bucket, S3Key = var.release.artifacts.durable.key, S3ObjectVersion = var.release.artifacts.durable.version_id },
          KmsKeyArn     = var.release.platform_kms_key_arn,
          DurableConfig = { ExecutionTimeout = 900, RetentionPeriodInDays = 7, KMSKeyArn = var.release.platform_kms_key_arn },
          Environment   = { Variables = local.durable_environment },
          LoggingConfig = { LogFormat = "JSON", ApplicationLogLevel = "ERROR", SystemLogLevel = "WARN", LogGroup = local.log_group }
        }
      },
      DurableVersion = {
        Type = "AWS::Lambda::Version", DeletionPolicy = "Retain", UpdateReplacePolicy = "Retain",
        Properties = {
          FunctionName = { Ref = "DurableFunction" }, CodeSha256 = var.release.artifacts.durable.base64sha256,
          Description  = "Immutable ${sha256(jsonencode(local.durable_environment))}"
        }
      }
    },
    Outputs = { DurableVersionArn = { Value = { "Fn::Join" = [":", [{ "Fn::GetAtt" = ["DurableFunction", "Arn"] }, { "Fn::GetAtt" = ["DurableVersion", "Version"] }]] } } }
  })
}
resource "aws_lambda_function" "dispatch" {
  count                          = local.deployed ? 1 : 0
  depends_on                     = [aws_iam_role_policy.runtime, aws_iam_role_policy.dispatch]
  function_name                  = local.names.dispatch
  role                           = aws_iam_role.runtime["dispatch"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 60
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts.dispatch.key
  s3_object_version              = var.release.artifacts.dispatch.version_id
  source_code_hash               = var.release.artifacts.dispatch.base64sha256
  layers                         = [var.release.extension_layer_arn]
  kms_key_arn                    = var.release.platform_kms_key_arn
  environment {
    variables = merge(local.common_environment, {
      RELEASE_SHA                            = var.release.artifacts.dispatch.sha256,
      NATIVE_RESUME_REQUEST_DISPATCH_ENABLED = tostring(var.enabled),
      NATIVE_RESUME_PREPARATION_WORKFLOW_ARN = aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"],
      NATIVE_RESUME_DEPLOYMENT_JSON          = jsonencode(local.deployment)
    })
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
}
resource "aws_cloudwatch_event_rule" "dispatch" {
  count               = local.deployed ? 1 : 0
  name                = local.names.dispatch
  schedule_expression = "rate(1 minute)"
  state               = var.schedule_enabled ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "dispatch" {
  count     = local.deployed ? 1 : 0
  rule      = aws_cloudwatch_event_rule.dispatch[0].name
  target_id = "original-resume-requests"
  arn       = aws_lambda_function.dispatch[0].qualified_arn
  input     = jsonencode({ schemaVersion = 1, action = "sweep" })
  retry_policy {
    maximum_event_age_in_seconds = 60
    maximum_retry_attempts       = 0
  }
}
resource "aws_lambda_permission" "dispatch" {
  count          = local.deployed ? 1 : 0
  statement_id   = "ExactResumeDispatchSchedule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.dispatch[0].function_name
  qualifier      = aws_lambda_function.dispatch[0].version
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.dispatch[0].arn
  source_account = var.account_id
}
output "control_function_arn" { value = local.deployed ? aws_lambda_function.control[0].qualified_arn : null }
output "workflow_function_arn" { value = local.deployed ? aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"] : null }
output "dispatch_function_arn" { value = local.deployed ? aws_lambda_function.dispatch[0].qualified_arn : null }
output "launch_configuration" { value = local.launch }

variable "observation_events_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.observation_events_enabled || var.enabled
    error_message = "Event observation requires its private runtime gate."
  }
}
resource "aws_iam_role_policy" "observer" {
  count = local.deployed ? 1 : 0
  name  = "original-task-observation-only"
  role  = aws_iam_role.runtime["observer"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:us-east-2:${var.account_id}:task/${element(reverse(split("/", var.release.cluster_arn)), 0)}/*", Condition = { ArnEquals = { "ecs:cluster" = var.release.cluster_arn } } },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = var.release.observer_dead_letter_arn },
    { Effect = "Allow", Action = ["kms:GenerateDataKey"], Resource = var.release.platform_kms_key_arn },
    { Effect = "Deny", Action = ["ecs:RunTask", "ecs:StopTask", "iam:PassRole", "lambda:InvokeFunction"], Resource = "*" }
  ] })
}
resource "aws_lambda_function" "observer" {
  count                          = local.deployed ? 1 : 0
  function_name                  = local.names.observer
  role                           = aws_iam_role.runtime["observer"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 2
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts.observer.key
  s3_object_version              = var.release.artifacts.observer.version_id
  source_code_hash               = var.release.artifacts.observer.base64sha256
  layers                         = [var.release.extension_layer_arn]
  kms_key_arn                    = var.release.platform_kms_key_arn
  environment {
    variables = merge(local.common_environment, {
      RELEASE_SHA                               = var.release.artifacts.observer.sha256,
      NATIVE_RESUME_TASK_OBSERVER_ENABLED       = tostring(var.enabled),
      NATIVE_RESUME_OBSERVER_CONFIGURATION_JSON = jsonencode(local.launch)
    })
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
  dead_letter_config { target_arn = var.release.observer_dead_letter_arn }
  depends_on = [aws_iam_role_policy.runtime, aws_iam_role_policy.observer]
}
resource "aws_cloudwatch_event_rule" "observer" {
  count         = local.deployed ? 1 : 0
  name          = local.names.observer
  state         = var.observation_events_enabled ? "ENABLED" : "DISABLED"
  event_pattern = jsonencode({ source = ["aws.ecs"], "detail-type" = ["ECS Task State Change"], account = [var.account_id], region = ["us-east-2"], detail = { clusterArn = [var.release.cluster_arn], taskDefinitionArn = [var.release.task_definition_arn], lastStatus = ["STOPPED"] } })
}
resource "aws_cloudwatch_event_target" "observer" {
  count     = local.deployed ? 1 : 0
  rule      = aws_cloudwatch_event_rule.observer[0].name
  target_id = "original-resume-stopped-observation"
  arn       = aws_lambda_function.observer[0].qualified_arn
  dead_letter_config { arn = var.release.observer_dead_letter_arn }
  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 185
  }
}
resource "aws_lambda_permission" "observer" {
  count          = local.deployed ? 1 : 0
  statement_id   = "ExactResumeStoppedRule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.observer[0].function_name
  qualifier      = aws_lambda_function.observer[0].version
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.observer[0].arn
  source_account = var.account_id
}
output "observer_function_arn" { value = local.deployed ? aws_lambda_function.observer[0].qualified_arn : null }
output "observer_rule_arn" { value = local.deployed ? aws_cloudwatch_event_rule.observer[0].arn : null }
