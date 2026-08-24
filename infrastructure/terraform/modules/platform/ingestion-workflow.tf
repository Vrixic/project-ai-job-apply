variable "deploy_ingestion_runtime" {
  description = "Create the source-neutral durable ingestion data plane. This does not activate it."
  type        = bool
  default     = false
}

variable "ingestion_runtime_enabled" {
  description = "Enable the reviewed schedule, queue mapping, and terminal reconciliation after deployment."
  type        = bool
  default     = false

  validation {
    condition = !var.ingestion_runtime_enabled || (
      var.deploy_ingestion_runtime && var.runtime_activation_allowed
    )
    error_message = "The ingestion runtime cannot be enabled unless it is deployed and global runtime activation is allowed."
  }
}

variable "ingestion_synthetic_source_enabled" {
  description = "Permit only the built-in generated-synthetic source to create schedule occurrences."
  type        = bool
  default     = false

  validation {
    condition     = !var.ingestion_synthetic_source_enabled || var.ingestion_runtime_enabled
    error_message = "The synthetic source cannot be enabled while the ingestion runtime is disabled."
  }
}

variable "ingestion_provider_activation_allowed" {
  description = "Authorize only explicitly configured public ATS sources after accountable review."
  type        = bool
  default     = false
}

variable "ingestion_provider_sources" {
  description = "Reviewed public ATS company/tenant configurations. Every entry remains independently default-off."
  type = list(object({
    provider                = string
    source_id               = string
    enabled                 = bool
    tenant                  = string
    region                  = optional(string, "global")
    company_name            = string
    verified_company_domain = string
  }))
  default = []

  validation {
    condition = length(var.ingestion_provider_sources) <= 8 && length(jsonencode(var.ingestion_provider_sources)) <= 1800 && length(distinct([
      for source in var.ingestion_provider_sources : source.source_id
      ])) == length(var.ingestion_provider_sources) && alltrue([
      for source in var.ingestion_provider_sources :
      contains(["greenhouse", "lever", "ashby"], source.provider) &&
      can(regex("^${source.provider}-[a-z0-9][a-z0-9-]{2,57}$", source.source_id)) &&
      can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$", source.tenant)) &&
      can(regex("^[^[:cntrl:]]{1,500}$", source.company_name)) &&
      can(regex("^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", lower(source.verified_company_domain))) &&
      (source.provider == "lever" ? contains(["global", "eu"], source.region) : source.region == "global")
    ])
    error_message = "Provider sources must be unique, bounded, exact Greenhouse/Lever/Ashby company configurations."
  }
}

variable "ingestion_durable_artifact_s3_key" {
  type    = string
  default = ""
}
variable "ingestion_durable_artifact_s3_object_version" {
  type    = string
  default = ""
}
variable "ingestion_durable_artifact_sha256" {
  type    = string
  default = ""
}
variable "ingestion_durable_artifact_base64sha256" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_s3_key" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_s3_object_version" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_sha256" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_base64sha256" {
  type    = string
  default = ""
}
variable "ingestion_lambda_extension_layer_arn" {
  type    = string
  default = ""
}
variable "ingestion_synthetic_seed" {
  type    = string
  default = "foundation01"
}
variable "ingestion_execution_timeout_seconds" {
  type    = number
  default = 3600
}
variable "ingestion_retention_days" {
  type    = number
  default = 30
}

locals {
  ingestion_durable_name = "${var.name}-${var.environment}-ingestion-durable"
  ingestion_durable_arn  = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${local.ingestion_durable_name}"
  ingestion_runtime_handlers = {
    coordinator = { handler = "index.coordinator", timeout = 60 }
    starter     = { handler = "index.starter", timeout = 30 }
    terminal    = { handler = "index.terminal", timeout = 30 }
  }
  ingestion_runtime_role_names  = toset(["coordinator", "starter", "activity", "terminal"])
  ingestion_durable_version_arn = var.deploy_ingestion_runtime ? aws_cloudformation_stack.ingestion_durable[0].outputs["DurableVersionArn"] : ""
  ingestion_schedule_rule_arn   = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-ingestion-schedule"
  ingestion_terminal_rule_arn   = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-ingestion-terminal"
  ingestion_provider_sources_json = jsonencode([
    for source in var.ingestion_provider_sources : merge({
      schemaVersion         = 1
      provider              = source.provider
      sourceId              = source.source_id
      enabled               = source.enabled
      companyName           = source.company_name
      verifiedCompanyDomain = lower(source.verified_company_domain)
      }, source.provider == "greenhouse" ? {
      boardToken = source.tenant
      } : source.provider == "lever" ? {
      site   = source.tenant
      region = source.region
      } : {
      jobBoardName = source.tenant
    })
  ])
}

resource "terraform_data" "ingestion_activation_guard" {
  input = {
    deploy                        = var.deploy_ingestion_runtime
    runtime                       = var.ingestion_runtime_enabled
    synthetic_only                = var.ingestion_synthetic_source_enabled
    provider_activation_allowed   = var.ingestion_provider_activation_allowed
    provider_source_count         = length(var.ingestion_provider_sources)
    provider_configuration_sha256 = sha256(local.ingestion_provider_sources_json)
  }

  lifecycle {
    precondition {
      condition = !var.deploy_ingestion_runtime || (
        can(regex("^[a-zA-Z0-9/_.-]+$", var.ingestion_durable_artifact_s3_key)) &&
        var.ingestion_durable_artifact_s3_object_version != "" &&
        can(regex("^[a-f0-9]{64}$", var.ingestion_durable_artifact_sha256)) &&
        var.ingestion_durable_artifact_base64sha256 != "" &&
        can(regex("^[a-zA-Z0-9/_.-]+$", var.ingestion_runtime_artifact_s3_key)) &&
        var.ingestion_runtime_artifact_s3_object_version != "" &&
        can(regex("^[a-f0-9]{64}$", var.ingestion_runtime_artifact_sha256)) &&
        var.ingestion_runtime_artifact_base64sha256 != "" &&
        can(regex("^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:layer:[A-Za-z0-9-_]+:[1-9][0-9]*$", var.ingestion_lambda_extension_layer_arn)) &&
        can(regex("^[a-z0-9]{8,64}$", var.ingestion_synthetic_seed))
        && var.persistent_data_plane_enabled
        && var.ingestion_execution_timeout_seconds >= 60
        && var.ingestion_execution_timeout_seconds <= 86400
        && var.ingestion_retention_days == 30
      )
      error_message = "A deployed ingestion runtime requires exact immutable artifacts, a numeric extension layer, and a canonical synthetic seed."
    }
    precondition {
      condition = !var.ingestion_provider_activation_allowed || (
        var.ingestion_runtime_enabled &&
        var.private_application_networking &&
        length([for source in var.ingestion_provider_sources : source if source.enabled]) > 0
      )
      error_message = "Provider activation requires the enabled ingestion runtime, private NAT egress, and at least one exact enabled source."
    }
    precondition {
      condition = var.ingestion_provider_activation_allowed || alltrue([
        for source in var.ingestion_provider_sources : !source.enabled
      ])
      error_message = "A provider source cannot be enabled without explicit provider activation authority."
    }
  }
}

data "aws_iam_policy_document" "ingestion_assume" {
  count = var.deploy_ingestion_runtime ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_sqs_queue" "ingestion_dead_letter" {
  count                     = var.deploy_ingestion_runtime ? 1 : 0
  name                      = "${var.name}-${var.environment}-ingestion-dead-letter"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn
}

resource "aws_sqs_queue" "ingestion_dispatch" {
  count                      = var.deploy_ingestion_runtime ? 1 : 0
  name                       = "${var.name}-${var.environment}-ingestion-dispatch"
  message_retention_seconds  = 345600
  visibility_timeout_seconds = 180
  kms_master_key_id          = aws_kms_key.platform.arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_dead_letter[0].arn
    maxReceiveCount     = 5
  })
}

resource "aws_iam_role" "ingestion_runtime" {
  for_each             = var.deploy_ingestion_runtime ? local.ingestion_runtime_role_names : toset([])
  name                 = "${var.name}-${var.environment}-ingestion-${each.key}"
  assume_role_policy   = data.aws_iam_policy_document.ingestion_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

resource "aws_iam_role" "ingestion_durable" {
  count                = var.deploy_ingestion_runtime ? 1 : 0
  name                 = local.ingestion_durable_name
  assume_role_policy   = data.aws_iam_policy_document.ingestion_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

data "aws_iam_policy_document" "ingestion_runtime" {
  for_each = var.deploy_ingestion_runtime ? local.ingestion_runtime_role_names : toset([])
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.application.arn}:*"]
  }
  statement {
    actions   = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"]
    resources = ["*"]
  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [local.platform_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:SecretARN"
      values   = [aws_secretsmanager_secret.database_url.arn]
    }
  }
  dynamic "statement" {
    for_each = each.key == "coordinator" ? [1] : []
    content {
      actions   = ["sqs:SendMessage"]
      resources = [aws_sqs_queue.ingestion_dispatch[0].arn]
    }
  }
  dynamic "statement" {
    for_each = each.key == "coordinator" ? [1] : []
    content {
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = [local.platform_kms_key_arn]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["sqs.${data.aws_region.current.region}.amazonaws.com"]
      }
      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:aws:sqs:arn"
        values   = [aws_sqs_queue.ingestion_dispatch[0].arn]
      }
    }
  }
  dynamic "statement" {
    for_each = each.key == "coordinator" ? [1] : []
    content {
      actions   = ["lambda:GetDurableExecution"]
      resources = ["${local.ingestion_durable_arn}:*/durable-execution/*"]
    }
  }
  dynamic "statement" {
    for_each = each.key == "starter" ? [1] : []
    content {
      actions = [
        "sqs:ChangeMessageVisibility",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ReceiveMessage"
      ]
      resources = [aws_sqs_queue.ingestion_dispatch[0].arn]
    }
  }
  dynamic "statement" {
    for_each = each.key == "starter" ? [1] : []
    content {
      actions   = ["kms:Decrypt"]
      resources = [local.platform_kms_key_arn]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["sqs.${data.aws_region.current.region}.amazonaws.com"]
      }
      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:aws:sqs:arn"
        values   = [aws_sqs_queue.ingestion_dispatch[0].arn]
      }
    }
  }
  statement {
    actions   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ingestion_runtime" {
  for_each = data.aws_iam_policy_document.ingestion_runtime
  name     = "ingestion-${each.key}"
  role     = aws_iam_role.ingestion_runtime[each.key].id
  policy   = each.value.json
}

resource "aws_lambda_function" "ingestion_runtime" {
  for_each                       = var.deploy_ingestion_runtime ? local.ingestion_runtime_handlers : {}
  function_name                  = "${var.name}-${var.environment}-ingestion-${each.key}"
  description                    = "Source-neutral default-off ingestion ${each.key}"
  role                           = aws_iam_role.ingestion_runtime[each.key].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = each.value.handler
  memory_size                    = 512
  timeout                        = each.value.timeout
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.ingestion_runtime_artifact_s3_key
  s3_object_version              = var.ingestion_runtime_artifact_s3_object_version
  source_code_hash               = var.ingestion_runtime_artifact_base64sha256
  layers                         = [var.ingestion_lambda_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn
  environment {
    variables = {
      NODE_ENV                              = "production"
      RELEASE_SHA                           = var.ingestion_runtime_artifact_sha256
      DATABASE_SECRET_ID                    = aws_secretsmanager_secret.database_url.arn
      AWS_ACCOUNT_ID                        = data.aws_caller_identity.current.account_id
      INGESTION_QUEUE_URL                   = aws_sqs_queue.ingestion_dispatch[0].url
      INGESTION_QUEUE_ARN                   = aws_sqs_queue.ingestion_dispatch[0].arn
      INGESTION_DURABLE_FUNCTION_ARN        = local.ingestion_durable_version_arn
      INGESTION_ACTIVITY_FUNCTION_ARN       = aws_lambda_function.ingestion_activity[0].qualified_arn
      INGESTION_SCHEDULE_RULE_ARN           = local.ingestion_schedule_rule_arn
      INGESTION_SYNTHETIC_SOURCE_ENABLED    = tostring(var.ingestion_synthetic_source_enabled)
      INGESTION_SYNTHETIC_SEED              = var.ingestion_synthetic_seed
      INGESTION_PROVIDER_ACTIVATION_ALLOWED = tostring(var.ingestion_provider_activation_allowed)
      INGESTION_PROVIDER_SOURCES            = local.ingestion_provider_sources_json
    }
  }
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.application.id]
  }
  tracing_config { mode = "Active" }
  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "WARN"
    log_group             = aws_cloudwatch_log_group.application.name
  }
  lifecycle { create_before_destroy = true }
  depends_on = [aws_iam_role_policy.ingestion_runtime, aws_vpc_endpoint.secretsmanager, terraform_data.ingestion_activation_guard]
}

resource "aws_lambda_function" "ingestion_activity" {
  count                          = var.deploy_ingestion_runtime ? 1 : 0
  function_name                  = "${var.name}-${var.environment}-ingestion-activity"
  description                    = "Source-neutral default-off ingestion activity"
  role                           = aws_iam_role.ingestion_runtime["activity"].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.activity"
  memory_size                    = 512
  timeout                        = 900
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.ingestion_runtime_artifact_s3_key
  s3_object_version              = var.ingestion_runtime_artifact_s3_object_version
  source_code_hash               = var.ingestion_runtime_artifact_base64sha256
  layers                         = [var.ingestion_lambda_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn
  environment {
    variables = {
      NODE_ENV                              = "production"
      RELEASE_SHA                           = var.ingestion_runtime_artifact_sha256
      DATABASE_SECRET_ID                    = aws_secretsmanager_secret.database_url.arn
      AWS_ACCOUNT_ID                        = data.aws_caller_identity.current.account_id
      INGESTION_SYNTHETIC_SOURCE_ENABLED    = tostring(var.ingestion_synthetic_source_enabled)
      INGESTION_SYNTHETIC_SEED              = var.ingestion_synthetic_seed
      INGESTION_PROVIDER_ACTIVATION_ALLOWED = tostring(var.ingestion_provider_activation_allowed)
      INGESTION_PROVIDER_SOURCES            = local.ingestion_provider_sources_json
    }
  }
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.application.id]
  }
  tracing_config { mode = "Active" }
  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "WARN"
    log_group             = aws_cloudwatch_log_group.application.name
  }
  lifecycle { create_before_destroy = true }
  depends_on = [aws_iam_role_policy.ingestion_runtime, aws_vpc_endpoint.secretsmanager, terraform_data.ingestion_activation_guard]
}

resource "aws_lambda_alias" "ingestion_activity" {
  count            = var.deploy_ingestion_runtime ? 1 : 0
  name             = var.environment
  function_name    = aws_lambda_function.ingestion_activity[0].function_name
  function_version = aws_lambda_function.ingestion_activity[0].version
}

resource "aws_lambda_alias" "ingestion_runtime" {
  for_each         = aws_lambda_function.ingestion_runtime
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} ingestion ${each.key} release"
  function_name    = each.value.function_name
  function_version = each.value.version
}

data "aws_iam_policy_document" "ingestion_durable" {
  count = var.deploy_ingestion_runtime ? 1 : 0
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.application.arn}:*"]
  }
  statement {
    actions   = ["lambda:CheckpointDurableExecution", "lambda:GetDurableExecutionState"]
    resources = ["${local.ingestion_durable_arn}:*"]
  }
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = ["${aws_lambda_function.ingestion_activity[0].arn}:*"]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.ingestion_dead_letter[0].arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [local.platform_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["lambda.${data.aws_region.current.region}.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:aws:lambda:FunctionArn"
      values   = [local.ingestion_durable_arn]
    }
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.platform_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["sqs.${data.aws_region.current.region}.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:aws:sqs:arn"
      values   = [aws_sqs_queue.ingestion_dead_letter[0].arn]
    }
  }
  statement {
    actions   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ingestion_durable" {
  count  = var.deploy_ingestion_runtime ? 1 : 0
  name   = "ingestion-durable"
  role   = aws_iam_role.ingestion_durable[0].id
  policy = data.aws_iam_policy_document.ingestion_durable[0].json
}

resource "time_sleep" "ingestion_policy_propagation" {
  count           = var.deploy_ingestion_runtime ? 1 : 0
  create_duration = "45s"
  triggers = {
    role_arn      = aws_iam_role.ingestion_durable[0].arn
    policy_sha256 = sha256(data.aws_iam_policy_document.ingestion_durable[0].json)
  }
  depends_on = [aws_iam_role_policy.ingestion_durable]
}

resource "aws_cloudformation_stack" "ingestion_durable" {
  count      = var.deploy_ingestion_runtime ? 1 : 0
  name       = local.ingestion_durable_name
  on_failure = "DELETE"
  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Description              = "CMK-encrypted versioned synthetic ingestion durable function"
    Resources = {
      DurableFunction = {
        Type = "AWS::Lambda::Function"
        Properties = {
          FunctionName                 = local.ingestion_durable_name
          Description                  = "Identifier-only synthetic ingestion orchestrator"
          Runtime                      = "nodejs24.x"
          Architectures                = ["x86_64"]
          Handler                      = "index.handler"
          Role                         = aws_iam_role.ingestion_durable[0].arn
          MemorySize                   = 512
          Timeout                      = 30
          ReservedConcurrentExecutions = 1
          Code = {
            S3Bucket        = aws_s3_bucket.artifacts.bucket
            S3Key           = var.ingestion_durable_artifact_s3_key
            S3ObjectVersion = var.ingestion_durable_artifact_s3_object_version
          }
          KmsKeyArn = aws_kms_key.platform.arn
          DurableConfig = {
            ExecutionTimeout      = var.ingestion_execution_timeout_seconds
            RetentionPeriodInDays = var.ingestion_retention_days
            KMSKeyArn             = aws_kms_key.platform.arn
          }
          DeadLetterConfig = { TargetArn = aws_sqs_queue.ingestion_dead_letter[0].arn }
          Environment = {
            Variables = {
              NODE_ENV                        = "production"
              RELEASE_SHA                     = var.ingestion_durable_artifact_sha256
              INGESTION_ACTIVITY_FUNCTION_ARN = aws_lambda_function.ingestion_activity[0].qualified_arn
            }
          }
          TracingConfig = { Mode = "Active" }
          LoggingConfig = {
            LogFormat           = "JSON"
            ApplicationLogLevel = "INFO"
            SystemLogLevel      = "WARN"
            LogGroup            = aws_cloudwatch_log_group.application.name
          }
          Tags = [{ Key = "Project", Value = var.name }, { Key = "Environment", Value = var.environment }, { Key = "ManagedBy", Value = "terraform-cloudformation" }]
        }
      }
      DurableVersion = {
        Type                = "AWS::Lambda::Version"
        DeletionPolicy      = "Retain"
        UpdateReplacePolicy = "Retain"
        Properties = {
          FunctionName = { Ref = "DurableFunction" }
          CodeSha256   = var.ingestion_durable_artifact_base64sha256
          Description  = "Immutable ${var.ingestion_durable_artifact_sha256}"
        }
      }
      DurableAlias = {
        Type = "AWS::Lambda::Alias"
        Properties = {
          Name            = var.environment
          FunctionName    = { Ref = "DurableFunction" }
          FunctionVersion = { "Fn::GetAtt" = ["DurableVersion", "Version"] }
        }
      }
    }
    Outputs = {
      DurableVersionArn = { Value = { "Fn::Join" = [":", [{ "Fn::GetAtt" = ["DurableFunction", "Arn"] }, { "Fn::GetAtt" = ["DurableVersion", "Version"] }]] } }
      DurableAliasArn   = { Value = { Ref = "DurableAlias" } }
    }
  })
  depends_on = [aws_iam_role_policy.ingestion_durable, time_sleep.ingestion_policy_propagation, aws_lambda_function.ingestion_activity]
}

data "aws_iam_policy_document" "ingestion_start_durable" {
  count = var.deploy_ingestion_runtime ? 1 : 0
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = ["${local.ingestion_durable_arn}:*"]
  }
}

resource "aws_iam_role_policy" "ingestion_start_durable" {
  count  = var.deploy_ingestion_runtime ? 1 : 0
  name   = "ingestion-start-exact-durable-version"
  role   = aws_iam_role.ingestion_runtime["starter"].id
  policy = data.aws_iam_policy_document.ingestion_start_durable[0].json
}

resource "aws_cloudwatch_event_rule" "ingestion_schedule" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  name                = "${var.name}-${var.environment}-ingestion-schedule"
  schedule_expression = "rate(5 minutes)"
  state               = var.ingestion_runtime_enabled ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "ingestion_schedule" {
  count = var.deploy_ingestion_runtime ? 1 : 0
  rule  = aws_cloudwatch_event_rule.ingestion_schedule[0].name
  arn   = aws_lambda_alias.ingestion_runtime["coordinator"].arn
  dead_letter_config { arn = aws_sqs_queue.ingestion_dead_letter[0].arn }
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 5
  }
}
resource "aws_lambda_permission" "ingestion_schedule" {
  count         = var.deploy_ingestion_runtime ? 1 : 0
  statement_id  = "AllowExactIngestionSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingestion_runtime["coordinator"].function_name
  qualifier     = aws_lambda_alias.ingestion_runtime["coordinator"].name
  principal     = "events.amazonaws.com"
  source_arn    = local.ingestion_schedule_rule_arn
}

resource "aws_lambda_event_source_mapping" "ingestion_dispatch" {
  count                   = var.deploy_ingestion_runtime ? 1 : 0
  event_source_arn        = aws_sqs_queue.ingestion_dispatch[0].arn
  function_name           = aws_lambda_alias.ingestion_runtime["starter"].arn
  enabled                 = var.ingestion_runtime_enabled
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
  depends_on              = [aws_iam_role_policy.ingestion_start_durable]
}

resource "aws_cloudwatch_event_rule" "ingestion_terminal" {
  count = var.deploy_ingestion_runtime ? 1 : 0
  name  = "${var.name}-${var.environment}-ingestion-terminal"
  state = var.ingestion_runtime_enabled ? "ENABLED" : "DISABLED"
  event_pattern = jsonencode({
    source      = ["aws.lambda"]
    detail-type = ["Durable Execution Status Change"]
    detail = {
      functionArn = [{ prefix = "${local.ingestion_durable_arn}:" }]
      status      = ["FAILED", "STOPPED", "SUCCEEDED", "TIMED_OUT"]
    }
  })
}
resource "aws_cloudwatch_event_target" "ingestion_terminal" {
  count = var.deploy_ingestion_runtime ? 1 : 0
  rule  = aws_cloudwatch_event_rule.ingestion_terminal[0].name
  arn   = aws_lambda_alias.ingestion_runtime["terminal"].arn
  dead_letter_config { arn = aws_sqs_queue.ingestion_dead_letter[0].arn }
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 5
  }
}
resource "aws_lambda_permission" "ingestion_terminal" {
  count         = var.deploy_ingestion_runtime ? 1 : 0
  statement_id  = "AllowExactIngestionTerminal"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingestion_runtime["terminal"].function_name
  qualifier     = aws_lambda_alias.ingestion_runtime["terminal"].name
  principal     = "events.amazonaws.com"
  source_arn    = local.ingestion_terminal_rule_arn
}

data "aws_iam_policy_document" "ingestion_dead_letter" {
  count = var.deploy_ingestion_runtime ? 1 : 0
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.ingestion_dead_letter[0].arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [local.ingestion_schedule_rule_arn, local.ingestion_terminal_rule_arn]
    }
  }
}

resource "aws_sqs_queue_policy" "ingestion_dead_letter" {
  count     = var.deploy_ingestion_runtime ? 1 : 0
  queue_url = aws_sqs_queue.ingestion_dead_letter[0].url
  policy    = data.aws_iam_policy_document.ingestion_dead_letter[0].json
}

resource "aws_cloudwatch_metric_alarm" "ingestion_dead_letter" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-dead-letter"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { QueueName = aws_sqs_queue.ingestion_dead_letter[0].name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_dispatch_age" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-dispatch-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 900
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { QueueName = aws_sqs_queue.ingestion_dispatch[0].name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_runtime_errors" {
  for_each            = aws_lambda_function.ingestion_runtime
  alarm_name          = "${var.name}-${var.environment}-ingestion-${each.key}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = each.value.function_name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_runtime_throttles" {
  for_each            = aws_lambda_function.ingestion_runtime
  alarm_name          = "${var.name}-${var.environment}-ingestion-${each.key}-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = each.value.function_name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_activity_errors" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-activity-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = aws_lambda_function.ingestion_activity[0].function_name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_activity_throttles" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-activity-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = aws_lambda_function.ingestion_activity[0].function_name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_durable_failed" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-durable-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DurableExecutionFailed"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = local.ingestion_durable_name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_durable_timed_out" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-durable-timed-out"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DurableExecutionTimedOut"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = local.ingestion_durable_name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_durable_throttles" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-durable-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = local.ingestion_durable_name }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_durable_duration" {
  count               = var.deploy_ingestion_runtime ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-ingestion-durable-duration"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "DurableExecutionDuration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Maximum"
  threshold           = var.ingestion_execution_timeout_seconds * 900
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { FunctionName = local.ingestion_durable_name }
}

output "ingestion_runtime_deployed" { value = var.deploy_ingestion_runtime }
output "ingestion_runtime_enabled" { value = var.ingestion_runtime_enabled }
output "ingestion_synthetic_source_enabled" { value = var.ingestion_synthetic_source_enabled }
output "ingestion_provider_activation_allowed" { value = var.ingestion_provider_activation_allowed }
output "ingestion_provider_source_count" { value = length(var.ingestion_provider_sources) }
output "ingestion_durable_version_arn" { value = local.ingestion_durable_version_arn }
output "ingestion_dispatch_queue_arn" { value = var.deploy_ingestion_runtime ? aws_sqs_queue.ingestion_dispatch[0].arn : "" }
output "ingestion_dead_letter_queue_arn" { value = var.deploy_ingestion_runtime ? aws_sqs_queue.ingestion_dead_letter[0].arn : "" }
