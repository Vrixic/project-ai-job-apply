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
variable "enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "launch_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.launch_enabled || var.enabled
    error_message = "Launch requires the activity runtime."
  }
}
variable "intake_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.intake_enabled || (var.enabled && var.launch_enabled && var.recovery_enabled)
    error_message = "New intake requires runtime, launch and recovery."
  }
}
variable "recovery_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "retained_versions" {
  description = "Original numeric workflow versions retained for dispatch and settlement."
  type        = set(string)
  default     = []
  validation {
    condition     = length(var.retained_versions) <= 19 && alltrue([for v in var.retained_versions : can(regex("^[1-9][0-9]{0,8}$", v))])
    error_message = "Retain at most nineteen numeric versions of this original workflow."
  }
}
variable "release" {
  description = "Immutable source artifacts and existing owner-managed infrastructure. No secret values."
  type = object({
    source_sha                 = string
    release_id                 = string
    artifact_bucket            = string
    artifacts                  = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
    database_secret_arn        = string
    platform_kms_key_arn       = string
    packet_encryption_key_arn  = string
    packet_fingerprint_key_arn = string
    launcher_function_arn      = string
    queue_arn                  = string
    queue_url                  = string
    queue_kms_key_arn          = string
    dead_letter_arn            = string
    extension_layer_arn        = string
    subnet_ids                 = list(string)
    security_group_ids         = list(string)
  })
  default = null
  validation {
    condition = var.release == null ? (!var.enabled && !var.recovery_enabled) : (
      can(regex("^[a-f0-9]{40}$", var.release.source_sha)) &&
      can(regex("^[a-z0-9]{1,12}$", var.release.release_id)) &&
      can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.release.artifact_bucket)) &&
      toset(keys(var.release.artifacts)) == toset(["activity", "durable", "starter", "recovery"]) &&
      alltrue([for kind, a in var.release.artifacts :
        can(regex("^[a-f0-9]{64}$", a.sha256)) && can(regex("^[A-Za-z0-9+/]{43}=$", a.base64sha256)) &&
        length(a.version_id) > 0 && a.version_id != "null" && length(a.version_id) <= 1024 &&
        a.key == "lambda/applications/native-preparation/${var.release.source_sha}/${a.sha256}/${lookup({ activity = "native-application-preparation-lambda", durable = "application-preparation-durable-lambda", starter = "application-preparation-starter-lambda", recovery = "application-preparation-recovery-lambda" }, kind, "invalid")}.zip"
      ]) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${var.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", var.release.database_secret_arn)) &&
      alltrue([for arn in [var.release.platform_kms_key_arn, var.release.packet_encryption_key_arn, var.release.packet_fingerprint_key_arn, var.release.queue_kms_key_arn] : can(regex("^arn:aws:kms:us-east-2:${var.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", arn))]) &&
      length(distinct([var.release.platform_kms_key_arn, var.release.packet_encryption_key_arn, var.release.packet_fingerprint_key_arn])) == 3 &&
      can(regex("^arn:aws:lambda:us-east-2:${var.account_id}:function:ai-job-apply-${var.environment}-[A-Za-z0-9_-]+:[1-9][0-9]{0,8}$", var.release.launcher_function_arn)) &&
      alltrue([for arn in [var.release.queue_arn, var.release.dead_letter_arn] : can(regex("^arn:aws:sqs:us-east-2:${var.account_id}:ai-job-apply-${var.environment}-[A-Za-z0-9_-]+$", arn))]) &&
      var.release.queue_arn != var.release.dead_letter_arn &&
      var.release.queue_url == "https://sqs.us-east-2.amazonaws.com/${var.account_id}/${element(reverse(split(":", var.release.queue_arn)), 0)}" &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.release.extension_layer_arn)) &&
      length(var.release.subnet_ids) >= 2 && length(var.release.subnet_ids) <= 3 && length(distinct(var.release.subnet_ids)) == length(var.release.subnet_ids) &&
      alltrue([for id in var.release.subnet_ids : can(regex("^subnet-[a-f0-9]{17}$", id))]) &&
      length(var.release.security_group_ids) >= 1 && length(var.release.security_group_ids) <= 2 && length(distinct(var.release.security_group_ids)) == length(var.release.security_group_ids) &&
      alltrue([for id in var.release.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))])
    )
    error_message = "Use four exact source-bound artifacts, distinct packet keys, numeric launcher and matching private queue/network identifiers."
  }
}

locals {
  deployed      = var.release != null
  kinds         = local.deployed ? toset(["activity", "durable", "starter", "terminal", "reconcile"]) : toset([])
  names         = { for kind in ["activity", "durable", "starter", "terminal", "reconcile"] : kind => "ai-job-apply-${var.environment}-prep-${kind}-${local.deployed ? var.release.release_id : "absent"}" }
  durable_arn   = "arn:aws:lambda:us-east-2:${var.account_id}:function:${local.names.durable}"
  log_group     = "/ai-job-apply/${var.environment}/application"
  workflow_arns = local.deployed ? sort(distinct(concat([aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"]], [for v in var.retained_versions : "${local.durable_arn}:${v}"]))) : []
  common        = { NODE_ENV = "production", PLATFORM_AWS_ACCOUNT_ID = var.account_id }
  database      = local.deployed ? { DATABASE_SECRET_ID = var.release.database_secret_arn, PARAMETERS_SECRETS_EXTENSION_LOG_LEVEL = "ERROR" } : {}
  workflow = local.deployed ? {
    APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN   = aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"]
    APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS = jsonencode(local.workflow_arns)
  } : {}
  activity_environment = local.deployed ? merge(local.common, local.database, {
    NATIVE_APPLICATION_PREPARATION_ENABLED        = tostring(var.enabled)
    NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED = tostring(var.launch_enabled)
    NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN           = var.release.launcher_function_arn
    RESTRICTED_PACKET_PROTECTION_ENABLED          = tostring(var.enabled)
    RESTRICTED_PACKET_ENCRYPTION_KEY_ARN          = var.release.packet_encryption_key_arn
    RESTRICTED_PACKET_FINGERPRINT_KEY_ARN         = var.release.packet_fingerprint_key_arn
  }) : {}
  environments = local.deployed ? {
    starter = merge(local.common, local.database, local.workflow, {
      APPLICATION_PREPARATION_STARTER_ENABLED = tostring(var.intake_enabled)
      APPLICATION_PREPARATION_QUEUE_ARN       = var.release.queue_arn
    })
    terminal = merge(local.common, local.database, local.workflow, {
      APPLICATION_PREPARATION_RECOVERY_ENABLED = tostring(var.recovery_enabled)
    })
    reconcile = merge(local.common, local.database, local.workflow, {
      APPLICATION_PREPARATION_RECOVERY_ENABLED  = tostring(var.recovery_enabled)
      APPLICATION_PREPARATION_NUDGES_ENABLED    = tostring(var.intake_enabled)
      APPLICATION_PREPARATION_QUEUE_URL         = var.release.queue_url
      APPLICATION_PREPARATION_RECOVERY_RULE_ARN = "arn:aws:events:us-east-2:${var.account_id}:rule/${local.names.reconcile}"
    })
  } : {}
  durable_environment = local.deployed ? merge(local.common, {
    APPLICATION_PREPARATION_DURABLE_ENABLED       = tostring(var.enabled)
    APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN = aws_lambda_function.activity[0].qualified_arn
    RELEASE_SHA                                   = var.release.artifacts.durable.sha256
  }) : {}
}
data "aws_caller_identity" "current" { count = local.deployed ? 1 : 0 }
data "aws_region" "current" { count = local.deployed ? 1 : 0 }

resource "aws_iam_role" "runtime" {
  for_each = local.kinds
  name     = local.names[each.key]
  # Separately reviewed bootstrap owns these ceilings; this module cannot broaden them.
  permissions_boundary = "arn:aws:iam::${var.account_id}:policy/${local.names[each.key]}-boundary"
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "base" {
  for_each = local.kinds
  name     = "private-preparation-base"
  role     = aws_iam_role.runtime[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${var.account_id}:log-group:${local.log_group}:*" },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.release.platform_kms_key_arn },
    { Effect = "Deny", Action = ["s3:*", "ecs:*", "iam:PassRole"], Resource = "*" }
    ], each.key == "durable" ? [] : [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.release.database_secret_arn },
    { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*" }
  ]) })
}
resource "aws_iam_role_policy" "activity" {
  count = local.deployed ? 1 : 0
  name  = "original-owner-and-packet"
  role  = aws_iam_role.runtime["activity"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = var.release.launcher_function_arn },
    { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = var.release.packet_encryption_key_arn },
    { Effect = "Allow", Action = ["kms:GenerateMac"], Resource = var.release.packet_fingerprint_key_arn }
  ] })
}
resource "aws_lambda_function" "activity" {
  count                          = local.deployed ? 1 : 0
  depends_on                     = [aws_iam_role_policy.base, aws_iam_role_policy.activity]
  function_name                  = local.names["activity"]
  role                           = aws_iam_role.runtime["activity"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 2
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts["activity"].key
  s3_object_version              = var.release.artifacts["activity"].version_id
  source_code_hash               = var.release.artifacts["activity"].base64sha256
  kms_key_arn                    = var.release.platform_kms_key_arn
  layers                         = [var.release.extension_layer_arn]
  environment { variables = merge(local.activity_environment, { RELEASE_SHA = var.release.artifacts["activity"].sha256 }) }
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
      error_message = "Provider account/region must match the reviewed release."
    }
  }
}
resource "aws_lambda_function" "runtime" {
  for_each                       = local.environments
  depends_on                     = [aws_iam_role_policy.base, aws_iam_role_policy.starter, aws_iam_role_policy.recovery]
  function_name                  = local.names[each.key]
  role                           = aws_iam_role.runtime[each.key].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = each.key == "terminal" ? "index.terminalHandler" : each.key == "reconcile" ? "index.reconcileHandler" : "index.handler"
  memory_size                    = 512
  timeout                        = each.key == "activity" ? 30 : 60
  reserved_concurrent_executions = each.key == "activity" ? 2 : 1
  publish                        = true
  s3_bucket                      = var.release.artifact_bucket
  s3_key                         = var.release.artifacts[contains(["terminal", "reconcile"], each.key) ? "recovery" : each.key].key
  s3_object_version              = var.release.artifacts[contains(["terminal", "reconcile"], each.key) ? "recovery" : each.key].version_id
  source_code_hash               = var.release.artifacts[contains(["terminal", "reconcile"], each.key) ? "recovery" : each.key].base64sha256
  kms_key_arn                    = var.release.platform_kms_key_arn
  layers                         = [var.release.extension_layer_arn]
  environment { variables = merge(each.value, { RELEASE_SHA = var.release.artifacts[contains(["terminal", "reconcile"], each.key) ? "recovery" : each.key].sha256 }) }
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
      error_message = "Provider account/region must match the reviewed release."
    }
  }
}
resource "aws_iam_role_policy" "durable" {
  count = local.deployed ? 1 : 0
  name  = "original-workflow"
  role  = aws_iam_role.runtime["durable"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["lambda:CheckpointDurableExecution", "lambda:GetDurableExecutionState"], Resource = "${local.durable_arn}:*" },
    { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.activity[0].qualified_arn },
    { Effect = "Deny", Action = ["secretsmanager:*", "rds-db:*"], Resource = "*" }
  ] })
}
resource "aws_cloudformation_stack" "durable" {
  count      = local.deployed ? 1 : 0
  name       = local.names.durable
  depends_on = [aws_iam_role_policy.base, aws_iam_role_policy.durable]
  on_failure = "DELETE"
  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = {
      DurableFunction = { Type = "AWS::Lambda::Function", Properties = {
        FunctionName  = local.names.durable, Runtime = "nodejs24.x", Architectures = ["x86_64"], Handler = "index.handler", Role = aws_iam_role.runtime["durable"].arn,
        MemorySize    = 512, Timeout = 30, ReservedConcurrentExecutions = 2,
        Code          = { S3Bucket = var.release.artifact_bucket, S3Key = var.release.artifacts.durable.key, S3ObjectVersion = var.release.artifacts.durable.version_id },
        KmsKeyArn     = var.release.platform_kms_key_arn,
        DurableConfig = { ExecutionTimeout = 900, RetentionPeriodInDays = 7, KMSKeyArn = var.release.platform_kms_key_arn },
        Environment   = { Variables = local.durable_environment },
        LoggingConfig = { LogFormat = "JSON", ApplicationLogLevel = "ERROR", SystemLogLevel = "WARN", LogGroup = local.log_group }
      } }
      DurableVersion = { Type = "AWS::Lambda::Version", DeletionPolicy = "Retain", UpdateReplacePolicy = "Retain", Properties = {
        FunctionName = { Ref = "DurableFunction" }, CodeSha256 = var.release.artifacts.durable.base64sha256, Description = "Immutable ${sha256(jsonencode(local.durable_environment))}"
      } }
    }
    Outputs = { DurableVersionArn = { Value = { "Fn::Join" = [":", [{ "Fn::GetAtt" = ["DurableFunction", "Arn"] }, { "Fn::GetAtt" = ["DurableVersion", "Version"] }]] } } }
  })
}
resource "aws_iam_role_policy" "starter" {
  count = local.deployed ? 1 : 0
  name  = "original-dispatch"
  role  = aws_iam_role.runtime["starter"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = local.workflow_arns },
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = var.release.queue_arn },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.release.queue_kms_key_arn }
  ] })
}
resource "aws_iam_role_policy" "recovery" {
  for_each = local.deployed ? toset(["terminal", "reconcile"]) : toset([])
  name     = "original-recovery"
  role     = aws_iam_role.runtime[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["lambda:GetDurableExecution"], Resource = [for arn in local.workflow_arns : "${arn}/durable-execution/*"] },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = var.release.dead_letter_arn },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = var.release.queue_kms_key_arn },
    { Effect = "Deny", Action = ["lambda:InvokeFunction"], Resource = "*" }
  ], each.key == "reconcile" ? [{ Effect = "Allow", Action = ["sqs:SendMessage"], Resource = var.release.queue_arn }] : []) })
}
resource "aws_lambda_event_source_mapping" "intake" {
  count                   = local.deployed ? 1 : 0
  depends_on              = [aws_iam_role_policy.starter]
  event_source_arn        = var.release.queue_arn
  function_name           = aws_lambda_function.runtime["starter"].qualified_arn
  enabled                 = var.intake_enabled
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}
resource "aws_cloudwatch_event_rule" "recovery" {
  for_each            = local.deployed ? toset(["terminal", "reconcile"]) : toset([])
  name                = local.names[each.key]
  state               = var.recovery_enabled ? "ENABLED" : "DISABLED"
  schedule_expression = each.key == "reconcile" ? "rate(1 minute)" : null
  event_pattern = each.key == "terminal" ? jsonencode({
    source = ["aws.lambda"], "detail-type" = ["Durable Execution Status Change"], account = [var.account_id], region = ["us-east-2"],
    detail = { functionArn = [{ prefix = "${local.durable_arn}:" }], status = ["SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"] }
  }) : null
}
resource "aws_cloudwatch_event_target" "recovery" {
  depends_on = [aws_lambda_permission.recovery, aws_lambda_function_event_invoke_config.recovery]
  for_each   = local.deployed ? toset(["terminal", "reconcile"]) : toset([])
  rule       = aws_cloudwatch_event_rule.recovery[each.key].name
  target_id  = "original-${each.key}"
  arn        = aws_lambda_function.runtime[each.key].qualified_arn
  dead_letter_config { arn = var.release.dead_letter_arn }
  retry_policy {
    maximum_event_age_in_seconds = each.key == "terminal" ? 86400 : 60
    maximum_retry_attempts       = each.key == "terminal" ? 185 : 0
  }
}
resource "aws_lambda_permission" "recovery" {
  for_each       = local.deployed ? toset(["terminal", "reconcile"]) : toset([])
  statement_id   = "OriginalRecoveryRule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.runtime[each.key].function_name
  qualifier      = aws_lambda_function.runtime[each.key].version
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.recovery[each.key].arn
  source_account = var.account_id
}
resource "aws_lambda_function_event_invoke_config" "recovery" {
  for_each                     = local.deployed ? toset(["terminal", "reconcile"]) : toset([])
  function_name                = aws_lambda_function.runtime[each.key].function_name
  qualifier                    = aws_lambda_function.runtime[each.key].version
  maximum_event_age_in_seconds = each.key == "terminal" ? 21600 : 60
  maximum_retry_attempts       = each.key == "terminal" ? 2 : 0
  destination_config {
    on_failure { destination = var.release.dead_letter_arn }
  }
}
output "functions" { value = merge({ for kind, f in aws_lambda_function.runtime : kind => f.qualified_arn }, local.deployed ? { activity = aws_lambda_function.activity[0].qualified_arn } : {}) }
output "durable_function_arn" { value = local.deployed ? aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"] : null }
output "role_arns" { value = { for kind, role in aws_iam_role.runtime : kind => role.arn } }
output "rule_arns" { value = { for kind, rule in aws_cloudwatch_event_rule.recovery : kind => rule.arn } }
