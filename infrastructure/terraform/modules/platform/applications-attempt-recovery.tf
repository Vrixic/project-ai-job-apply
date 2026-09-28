# Applications submission-attempt stale recovery (D3-005/D3-008/D3-011): a dedicated scheduled
# Lambda, isolated from the profile-readiness activity Lambda per this repo's per-service ownership
# rule, calling only the already-tested PostgresApplicationStore.recoverStaleAttempts.

locals {
  applications_attempt_recovery_function_name = "${var.name}-${var.environment}-applications-attempt-recovery"
  applications_attempt_recovery_rule_name     = "${var.name}-${var.environment}-applications-attempt-recovery"
  applications_attempt_recovery_rule_arn = (
    "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.applications_attempt_recovery_rule_name}"
  )
}

data "aws_iam_policy_document" "applications_attempt_recovery_assume" {
  count = var.applications_attempt_recovery_enabled ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "applications_attempt_recovery" {
  count                = var.applications_attempt_recovery_enabled ? 1 : 0
  name                 = "${var.name}-${var.environment}-applications-attempt-recovery"
  assume_role_policy   = data.aws_iam_policy_document.applications_attempt_recovery_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

data "aws_iam_policy_document" "applications_attempt_recovery" {
  count = var.applications_attempt_recovery_enabled ? 1 : 0

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
    resources = [local.platform_kms_key_arn]
  }

  statement {
    sid       = "WriteNativeTraces"
    effect    = "Allow"
    actions   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "applications_attempt_recovery" {
  count  = var.applications_attempt_recovery_enabled ? 1 : 0
  name   = "applications-attempt-recovery-runtime"
  role   = aws_iam_role.applications_attempt_recovery[0].id
  policy = data.aws_iam_policy_document.applications_attempt_recovery[0].json
}

resource "aws_sqs_queue" "applications_attempt_recovery_dead_letter" {
  count                     = var.applications_attempt_recovery_enabled ? 1 : 0
  name                      = "${var.name}-${var.environment}-applications-attempt-recovery-dead-letter"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn
}

resource "aws_lambda_function" "applications_attempt_recovery" {
  count                          = var.applications_attempt_recovery_enabled ? 1 : 0
  function_name                  = local.applications_attempt_recovery_function_name
  description                    = "Scheduled crash/replay recovery for submission attempts (D3-005/D3-008/D3-011)"
  role                           = aws_iam_role.applications_attempt_recovery[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 512
  timeout                        = 60
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.applications_attempt_recovery_artifact_s3_key
  s3_object_version              = var.applications_attempt_recovery_artifact_s3_object_version
  source_code_hash               = var.applications_attempt_recovery_artifact_base64sha256
  layers                         = [var.profile_readiness_lambda_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn

  environment {
    variables = {
      NODE_ENV                               = "production"
      RELEASE_SHA                            = var.applications_attempt_recovery_artifact_sha256
      DATABASE_SECRET_ID                     = aws_secretsmanager_secret.database_url.arn
      APPLICATIONS_ATTEMPT_RECOVERY_RULE_ARN = local.applications_attempt_recovery_rule_arn
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
    aws_iam_role_policy.applications_attempt_recovery,
    aws_vpc_endpoint.secretsmanager
  ]
}

resource "aws_lambda_alias" "applications_attempt_recovery" {
  count            = var.applications_attempt_recovery_enabled ? 1 : 0
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} applications attempt-recovery release"
  function_name    = aws_lambda_function.applications_attempt_recovery[0].function_name
  function_version = aws_lambda_function.applications_attempt_recovery[0].version
}

resource "aws_cloudwatch_event_rule" "applications_attempt_recovery" {
  count               = var.applications_attempt_recovery_enabled ? 1 : 0
  name                = local.applications_attempt_recovery_rule_name
  description         = "Resolve a submission attempt whose worker vanished before reporting a result"
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"
}

resource "aws_cloudwatch_event_target" "applications_attempt_recovery" {
  count     = var.applications_attempt_recovery_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.applications_attempt_recovery[0].name
  target_id = "applications-attempt-recovery"
  arn       = aws_lambda_alias.applications_attempt_recovery[0].arn

  dead_letter_config {
    arn = aws_sqs_queue.applications_attempt_recovery_dead_letter[0].arn
  }
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 5
  }
}

resource "aws_lambda_permission" "applications_attempt_recovery" {
  count         = var.applications_attempt_recovery_enabled ? 1 : 0
  statement_id  = "AllowExactApplicationsAttemptRecoveryRule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.applications_attempt_recovery[0].function_name
  qualifier     = aws_lambda_alias.applications_attempt_recovery[0].name
  principal     = "events.amazonaws.com"
  source_arn    = local.applications_attempt_recovery_rule_arn
}

resource "aws_cloudwatch_metric_alarm" "applications_attempt_recovery_errors" {
  count               = var.applications_attempt_recovery_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-applications-attempt-recovery-errors"
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
  alarm_description   = "The applications attempt-recovery sweep emitted an invocation error. Runbook: ${local.observability_runbook_url}"
  dimensions          = { FunctionName = aws_lambda_function.applications_attempt_recovery[0].function_name }
}

resource "aws_cloudwatch_metric_alarm" "applications_attempt_recovery_dead_letter" {
  count               = var.applications_attempt_recovery_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-applications-attempt-recovery-dead-letter"
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
  alarm_description   = "A scheduled invocation reached the applications attempt-recovery DLQ. Runbook: ${local.observability_runbook_url}"
  dimensions          = { QueueName = aws_sqs_queue.applications_attempt_recovery_dead_letter[0].name }
}
