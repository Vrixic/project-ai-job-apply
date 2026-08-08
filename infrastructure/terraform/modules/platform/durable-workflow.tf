locals {
  profile_readiness_durable_function_name = "${var.name}-${var.environment}-profile-readiness-durable"
  profile_readiness_durable_function_arn = (
    "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${local.profile_readiness_durable_function_name}"
  )
  profile_readiness_terminal_rule_name = "${var.name}-${var.environment}-profile-readiness-terminal"
  profile_readiness_terminal_rule_arn = (
    "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.profile_readiness_terminal_rule_name}"
  )
  profile_readiness_durable_version_arn = var.deploy_profile_readiness_durable ? (
    aws_cloudformation_stack.profile_readiness_durable[0].outputs["DurableVersionArn"]
  ) : ""
}

data "aws_iam_policy_document" "profile_readiness_lambda_assume" {
  count = var.deploy_profile_readiness_durable ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_sqs_queue" "profile_readiness_dead_letter" {
  count                     = var.deploy_profile_readiness_durable ? 1 : 0
  name                      = "${var.name}-${var.environment}-profile-readiness-dead-letter"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn
}

resource "aws_iam_role" "profile_readiness_activity" {
  count                = var.deploy_profile_readiness_durable ? 1 : 0
  name                 = "${var.name}-${var.environment}-profile-readiness-activity"
  assume_role_policy   = data.aws_iam_policy_document.profile_readiness_lambda_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

resource "aws_iam_role" "profile_readiness_terminal" {
  count                = var.deploy_profile_readiness_durable ? 1 : 0
  name                 = "${var.name}-${var.environment}-profile-readiness-terminal"
  assume_role_policy   = data.aws_iam_policy_document.profile_readiness_lambda_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

resource "aws_iam_role" "profile_readiness_durable" {
  count                = var.deploy_profile_readiness_durable ? 1 : 0
  name                 = "${var.name}-${var.environment}-profile-readiness-durable"
  assume_role_policy   = data.aws_iam_policy_document.profile_readiness_lambda_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

data "aws_iam_policy_document" "profile_readiness_database_handler" {
  count = var.deploy_profile_readiness_durable ? 1 : 0

  statement {
    sid       = "WriteOwnedLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.application.arn}:*"]
  }

  statement {
    sid    = "ManageVpcInterfaces"
    effect = "Allow"
    actions = [
      "ec2:AssignPrivateIpAddresses",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSubnets",
      "ec2:UnassignPrivateIpAddresses"
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ReadDatabaseSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn]
  }

  statement {
    sid       = "DecryptOwnedData"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.platform.arn]
  }

  statement {
    sid       = "WriteNativeTraces"
    effect    = "Allow"
    actions   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "profile_readiness_activity" {
  count  = var.deploy_profile_readiness_durable ? 1 : 0
  name   = "profile-readiness-activity-runtime"
  role   = aws_iam_role.profile_readiness_activity[0].id
  policy = data.aws_iam_policy_document.profile_readiness_database_handler[0].json
}

resource "aws_iam_role_policy" "profile_readiness_terminal" {
  count  = var.deploy_profile_readiness_durable ? 1 : 0
  name   = "profile-readiness-terminal-runtime"
  role   = aws_iam_role.profile_readiness_terminal[0].id
  policy = data.aws_iam_policy_document.profile_readiness_database_handler[0].json
}

resource "aws_lambda_function" "profile_readiness_activity" {
  count                          = var.deploy_profile_readiness_durable ? 1 : 0
  function_name                  = "${var.name}-${var.environment}-profile-readiness-activity"
  description                    = "Private replay-safe database activity for profile readiness"
  role                           = aws_iam_role.profile_readiness_activity[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.activity"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.profile_readiness_activity_artifact_s3_key
  s3_object_version              = var.profile_readiness_activity_artifact_s3_object_version
  source_code_hash               = var.profile_readiness_activity_artifact_base64sha256
  layers                         = [var.profile_readiness_lambda_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn

  environment {
    variables = {
      NODE_ENV           = "production"
      RELEASE_SHA        = var.profile_readiness_activity_artifact_sha256
      DATABASE_SECRET_ID = aws_secretsmanager_secret.database_url.arn
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

  depends_on = [
    aws_iam_role_policy.profile_readiness_activity,
    aws_vpc_endpoint.secretsmanager
  ]
}

resource "aws_lambda_alias" "profile_readiness_activity" {
  count            = var.deploy_profile_readiness_durable ? 1 : 0
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} profile-readiness activity release"
  function_name    = aws_lambda_function.profile_readiness_activity[0].function_name
  function_version = aws_lambda_function.profile_readiness_activity[0].version
}

data "aws_iam_policy_document" "profile_readiness_durable" {
  count = var.deploy_profile_readiness_durable ? 1 : 0

  statement {
    sid       = "WriteOwnedLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.application.arn}:*"]
  }

  statement {
    sid    = "CheckpointOnlyOwnedDurableFunction"
    effect = "Allow"
    actions = [
      "lambda:CheckpointDurableExecution",
      "lambda:GetDurableExecutionState"
    ]
    resources = ["${local.profile_readiness_durable_function_arn}:*"]
  }

  statement {
    sid       = "InvokeExactProfileActivityVersion"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.profile_readiness_activity[0].qualified_arn]
  }

  statement {
    sid       = "PreserveFailedIdentifierOnlyInput"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.profile_readiness_dead_letter[0].arn]
  }

  statement {
    sid    = "UseOwnedEncryptedDurableStateAndDlq"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey"
    ]
    resources = [aws_kms_key.platform.arn]
  }

  statement {
    sid       = "WriteNativeTraces"
    effect    = "Allow"
    actions   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "profile_readiness_durable" {
  count  = var.deploy_profile_readiness_durable ? 1 : 0
  name   = "profile-readiness-durable-runtime"
  role   = aws_iam_role.profile_readiness_durable[0].id
  policy = data.aws_iam_policy_document.profile_readiness_durable[0].json
}

# CloudFormation validates DeadLetterConfig against the role during CreateFunction, but IAM policy
# propagation is eventually consistent. Key the delay to the exact effective policy so initial
# creation and any permission change wait before CloudFormation performs that validation.
resource "time_sleep" "profile_readiness_durable_policy_propagation" {
  count           = var.deploy_profile_readiness_durable ? 1 : 0
  create_duration = "45s"

  triggers = {
    role_arn      = aws_iam_role.profile_readiness_durable[0].arn
    policy_sha256 = sha256(data.aws_iam_policy_document.profile_readiness_durable[0].json)
  }

  depends_on = [aws_iam_role_policy.profile_readiness_durable]
}

# The HashiCorp AWS provider exposes durable timeout/retention but not DurableConfig.KMSKeyArn.
# Keep the provider gap inside one Terraform-owned CloudFormation stack rather than applying an
# imperative post-create CLI mutation that Terraform cannot detect or reproduce.
resource "aws_cloudformation_stack" "profile_readiness_durable" {
  count = var.deploy_profile_readiness_durable ? 1 : 0
  name  = "${var.name}-${var.environment}-profile-readiness-durable"

  on_failure = "DELETE"
  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Description              = "CMK-encrypted versioned profile-readiness Lambda durable function"
    Resources = {
      DurableFunction = {
        Type = "AWS::Lambda::Function"
        Properties = {
          FunctionName                 = local.profile_readiness_durable_function_name
          Description                  = "Identifier-only profile-readiness durable orchestrator"
          Runtime                      = "nodejs24.x"
          Architectures                = ["x86_64"]
          Handler                      = "index.handler"
          Role                         = aws_iam_role.profile_readiness_durable[0].arn
          MemorySize                   = 512
          Timeout                      = 30
          ReservedConcurrentExecutions = 2
          Code = {
            S3Bucket        = aws_s3_bucket.artifacts.bucket
            S3Key           = var.profile_readiness_durable_artifact_s3_key
            S3ObjectVersion = var.profile_readiness_durable_artifact_s3_object_version
          }
          KmsKeyArn = aws_kms_key.platform.arn
          DurableConfig = {
            ExecutionTimeout      = var.profile_readiness_execution_timeout_seconds
            RetentionPeriodInDays = var.profile_readiness_retention_days
            KMSKeyArn             = aws_kms_key.platform.arn
          }
          DeadLetterConfig = {
            TargetArn = aws_sqs_queue.profile_readiness_dead_letter[0].arn
          }
          Environment = {
            Variables = {
              NODE_ENV                      = "production"
              RELEASE_SHA                   = var.profile_readiness_durable_artifact_sha256
              PROFILE_ACTIVITY_FUNCTION_ARN = aws_lambda_function.profile_readiness_activity[0].qualified_arn
            }
          }
          TracingConfig = { Mode = "Active" }
          LoggingConfig = {
            LogFormat           = "JSON"
            ApplicationLogLevel = "INFO"
            SystemLogLevel      = "WARN"
            LogGroup            = aws_cloudwatch_log_group.application.name
          }
          Tags = [
            { Key = "Project", Value = var.name },
            { Key = "Environment", Value = var.environment },
            { Key = "ManagedBy", Value = "terraform-cloudformation" }
          ]
        }
      }
      DurableVersion = {
        Type                = "AWS::Lambda::Version"
        DeletionPolicy      = "Retain"
        UpdateReplacePolicy = "Retain"
        Properties = {
          FunctionName = { Ref = "DurableFunction" }
          CodeSha256   = var.profile_readiness_durable_artifact_base64sha256
          Description  = "Immutable ${var.profile_readiness_durable_artifact_sha256}"
        }
      }
      DurableAlias = {
        Type = "AWS::Lambda::Alias"
        Properties = {
          Name            = var.environment
          Description     = "Reviewed immutable ${var.environment} profile-readiness durable release"
          FunctionName    = { Ref = "DurableFunction" }
          FunctionVersion = { "Fn::GetAtt" = ["DurableVersion", "Version"] }
        }
      }
    }
    Outputs = {
      DurableFunctionArn = { Value = { "Fn::GetAtt" = ["DurableFunction", "Arn"] } }
      DurableVersionArn = {
        Value = {
          "Fn::Join" = [":", [
            { "Fn::GetAtt" = ["DurableFunction", "Arn"] },
            { "Fn::GetAtt" = ["DurableVersion", "Version"] }
          ]]
        }
      }
      DurableAliasArn = { Value = { Ref = "DurableAlias" } }
    }
  })

  depends_on = [
    aws_iam_role_policy.profile_readiness_durable,
    time_sleep.profile_readiness_durable_policy_propagation,
    aws_lambda_function.profile_readiness_activity
  ]
}

resource "aws_lambda_function" "profile_readiness_terminal" {
  count                          = var.deploy_profile_readiness_durable ? 1 : 0
  function_name                  = "${var.name}-${var.environment}-profile-readiness-terminal"
  description                    = "Idempotent terminal-state reconciliation for exact durable executions"
  role                           = aws_iam_role.profile_readiness_terminal[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.terminal"
  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.profile_readiness_activity_artifact_s3_key
  s3_object_version              = var.profile_readiness_activity_artifact_s3_object_version
  source_code_hash               = var.profile_readiness_activity_artifact_base64sha256
  layers                         = [var.profile_readiness_lambda_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn

  environment {
    variables = {
      NODE_ENV             = "production"
      RELEASE_SHA          = var.profile_readiness_activity_artifact_sha256
      DATABASE_SECRET_ID   = aws_secretsmanager_secret.database_url.arn
      DURABLE_FUNCTION_ARN = local.profile_readiness_durable_version_arn
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

  depends_on = [
    aws_iam_role_policy.profile_readiness_terminal,
    aws_vpc_endpoint.secretsmanager,
    aws_cloudformation_stack.profile_readiness_durable
  ]
}

resource "aws_lambda_alias" "profile_readiness_terminal" {
  count            = var.deploy_profile_readiness_durable ? 1 : 0
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} profile-readiness terminal release"
  function_name    = aws_lambda_function.profile_readiness_terminal[0].function_name
  function_version = aws_lambda_function.profile_readiness_terminal[0].version
}

resource "aws_cloudwatch_event_rule" "profile_readiness_terminal" {
  count       = var.deploy_profile_readiness_durable ? 1 : 0
  name        = local.profile_readiness_terminal_rule_name
  description = "Exact durable terminal states; disabled until the reviewed serverless cutover"
  state       = var.serverless_runtime_enabled ? "ENABLED" : "DISABLED"
  event_pattern = jsonencode({
    source      = ["aws.lambda"]
    detail-type = ["Durable Execution Status Change"]
    detail = {
      functionArn = [local.profile_readiness_durable_version_arn]
      status      = ["FAILED", "STOPPED", "TIMED_OUT"]
    }
  })
}

resource "aws_cloudwatch_event_target" "profile_readiness_terminal" {
  count     = var.deploy_profile_readiness_durable ? 1 : 0
  rule      = aws_cloudwatch_event_rule.profile_readiness_terminal[0].name
  target_id = "profile-readiness-terminal"
  arn       = aws_lambda_alias.profile_readiness_terminal[0].arn

  dead_letter_config {
    arn = aws_sqs_queue.profile_readiness_dead_letter[0].arn
  }

  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 5
  }
}

resource "aws_lambda_permission" "profile_readiness_terminal" {
  count         = var.deploy_profile_readiness_durable ? 1 : 0
  statement_id  = "AllowExactDurableTerminalRule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.profile_readiness_terminal[0].function_name
  qualifier     = aws_lambda_alias.profile_readiness_terminal[0].name
  principal     = "events.amazonaws.com"
  source_arn    = local.profile_readiness_terminal_rule_arn
}

data "aws_iam_policy_document" "profile_readiness_dead_letter" {
  count = var.deploy_profile_readiness_durable ? 1 : 0

  statement {
    sid       = "AllowExactTerminalRuleDelivery"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.profile_readiness_dead_letter[0].arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [local.profile_readiness_terminal_rule_arn]
    }
  }
}

resource "aws_sqs_queue_policy" "profile_readiness_dead_letter" {
  count     = var.deploy_profile_readiness_durable ? 1 : 0
  queue_url = aws_sqs_queue.profile_readiness_dead_letter[0].url
  policy    = data.aws_iam_policy_document.profile_readiness_dead_letter[0].json
}

resource "aws_cloudwatch_metric_alarm" "profile_readiness_durable_failed" {
  count               = var.deploy_profile_readiness_durable ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-profile-readiness-durable-failed"
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
  alarm_description   = "A profile-readiness durable execution failed. Runbook: ${local.observability_runbook_url}"
  dimensions          = { FunctionName = local.profile_readiness_durable_function_name }
}

resource "aws_cloudwatch_metric_alarm" "profile_readiness_durable_timed_out" {
  count               = var.deploy_profile_readiness_durable ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-profile-readiness-durable-timed-out"
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
  alarm_description   = "A profile-readiness durable execution timed out. Runbook: ${local.observability_runbook_url}"
  dimensions          = { FunctionName = local.profile_readiness_durable_function_name }
}

resource "aws_cloudwatch_metric_alarm" "profile_readiness_activity_errors" {
  count               = var.deploy_profile_readiness_durable ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-profile-readiness-activity-errors"
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
  alarm_description   = "The profile-readiness database activity emitted an invocation error. Runbook: ${local.observability_runbook_url}"
  dimensions          = { FunctionName = aws_lambda_function.profile_readiness_activity[0].function_name }
}

resource "aws_cloudwatch_metric_alarm" "profile_readiness_dead_letter" {
  count               = var.deploy_profile_readiness_durable ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-profile-readiness-dead-letter"
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
  alarm_description   = "A durable invocation or terminal event reached the profile-readiness DLQ. Runbook: ${local.observability_runbook_url}"
  dimensions          = { QueueName = aws_sqs_queue.profile_readiness_dead_letter[0].name }
}
