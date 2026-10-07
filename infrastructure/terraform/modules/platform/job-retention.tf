variable "job_retention_release" {
  description = "Reviewed immutable Jobs-maintenance artifact; null creates nothing. No secret values."
  type = object({
    source_sha            = string
    artifact_key          = string
    artifact_version      = string
    artifact_sha256       = string
    artifact_base64sha256 = string
    extension_layer_arn   = string
  })
  default = null
  validation {
    condition = var.job_retention_release == null ? !var.job_retention_enabled : (
      can(regex("^[a-f0-9]{40}$", var.job_retention_release.source_sha)) &&
      can(regex("^[a-f0-9]{64}$", var.job_retention_release.artifact_sha256)) &&
      can(regex("^[A-Za-z0-9+/]{43}=$", var.job_retention_release.artifact_base64sha256)) &&
      length(var.job_retention_release.artifact_version) > 0 && var.job_retention_release.artifact_version != "null" &&
      var.job_retention_release.artifact_key == "lambda/jobs/retention/${var.job_retention_release.source_sha}/${var.job_retention_release.artifact_sha256}/job-retention-lambda.zip" &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.job_retention_release.extension_layer_arn))
    )
    error_message = "Use a complete immutable source-bound Jobs artifact and numeric Secrets extension layer; activation requires a release."
  }
}
variable "job_retention_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "job_retention_schedule_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.job_retention_schedule_enabled || var.job_retention_enabled
    error_message = "Scheduling requires the private Jobs runtime gate."
  }
}
locals {
  job_retention_deployed = var.job_retention_release != null
  job_retention_name     = "${var.name}-${var.environment}-job-retention"
}
resource "aws_iam_role" "job_retention" {
  count                = local.job_retention_deployed ? 1 : 0
  name                 = local.job_retention_name
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "job_retention" {
  count = local.job_retention_deployed ? 1 : 0
  name  = "owning-Jobs-expiry"
  role  = aws_iam_role.job_retention[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${data.aws_caller_identity.current.account_id}:log-group:/ai-job-apply/${var.environment}/application:*" },
    { Effect = "Allow", Action = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.database_url.arn },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.platform.arn },
    { Effect = "Deny", Action = ["ecs:*", "s3:*", "iam:PassRole", "lambda:InvokeFunction", "secretsmanager:PutSecretValue"], Resource = "*" }
  ] })
}
resource "aws_lambda_function" "job_retention" {
  count                          = local.job_retention_deployed ? 1 : 0
  function_name                  = local.job_retention_name
  role                           = aws_iam_role.job_retention[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 256
  timeout                        = 90
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.job_retention_release.artifact_key
  s3_object_version              = var.job_retention_release.artifact_version
  source_code_hash               = var.job_retention_release.artifact_base64sha256
  layers                         = [var.job_retention_release.extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn
  environment {
    variables = {
      NODE_ENV                               = "production"
      RELEASE_SHA                            = var.job_retention_release.artifact_sha256
      PLATFORM_AWS_ACCOUNT_ID                = data.aws_caller_identity.current.account_id
      DATABASE_SECRET_ID                     = aws_secretsmanager_secret.database_url.arn
      PARAMETERS_SECRETS_EXTENSION_LOG_LEVEL = "ERROR"
      JOB_RETENTION_ENABLED                  = tostring(var.job_retention_enabled)
      JOB_RETENTION_BATCH_LIMIT              = "100"
    }
  }
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.application.id]
  }
  logging_config {
    log_format            = "JSON"
    application_log_level = "ERROR"
    system_log_level      = "WARN"
    log_group             = "/ai-job-apply/${var.environment}/application"
  }
  depends_on = [aws_iam_role_policy.job_retention]
  lifecycle {
    precondition {
      condition     = var.persistent_data_plane_enabled && data.aws_region.current.region == "us-east-2"
      error_message = "Jobs maintenance requires the owning persistent database in us-east-2."
    }
  }
}
resource "aws_cloudwatch_event_rule" "job_retention" {
  count               = local.job_retention_deployed ? 1 : 0
  name                = local.job_retention_name
  schedule_expression = "rate(1 hour)"
  state               = var.job_retention_schedule_enabled ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "job_retention" {
  count     = local.job_retention_deployed ? 1 : 0
  rule      = aws_cloudwatch_event_rule.job_retention[0].name
  target_id = "bounded-Jobs-expiry"
  arn       = aws_lambda_function.job_retention[0].qualified_arn
  input     = jsonencode({ schemaVersion = 1, action = "expire" })
  retry_policy { maximum_retry_attempts = 0 }
}
resource "aws_lambda_permission" "job_retention" {
  count          = local.job_retention_deployed ? 1 : 0
  statement_id   = "ExactJobsRetentionRule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.job_retention[0].function_name
  qualifier      = aws_lambda_function.job_retention[0].version
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.job_retention[0].arn
  source_account = data.aws_caller_identity.current.account_id
}
resource "aws_cloudwatch_metric_alarm" "job_retention" {
  for_each            = local.job_retention_deployed ? { execution = { namespace = "AWS/Lambda", metric = "Errors", dimensions = { FunctionName = local.job_retention_name } }, delivery = { namespace = "AWS/Events", metric = "FailedInvocations", dimensions = { RuleName = local.job_retention_name } } } : {}
  alarm_name          = "${local.job_retention_name}-${each.key}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 60
  statistic           = "Sum"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "Jobs expiry failed; inspect fixed errors and retry bounded maintenance. No Jobs row content in alerts."
}
output "job_retention_function_arn" {
  value = local.job_retention_deployed ? aws_lambda_function.job_retention[0].qualified_arn : null
}
