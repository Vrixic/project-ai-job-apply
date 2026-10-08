variable "native_cleanup_deployments" {
  description = "Original native deployments retained for cleanup; runtime rejects every other task binding."
  type        = list(object({ cluster_arn = string, task_definition_arn = string, container_name = string }))
  default     = []
  nullable    = false
  validation {
    condition = length(var.native_cleanup_deployments) <= 8 && alltrue([for d in var.native_cleanup_deployments :
      can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", d.cluster_arn)) &&
      can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task-definition/${var.name}-${var.environment}-native-(material|resume):[1-9][0-9]{0,8}$", d.task_definition_arn)) &&
      contains(["native-material", "native-resume"], d.container_name)
    ])
    error_message = "Retain at most eight exact same-account native task deployments in us-east-2."
  }
}
locals {
  native_cleanup_clusters = local.native_cleanup_deployed ? sort(distinct([for d in var.native_cleanup_deployments : d.cluster_arn])) : []
  native_cleanup_task_statements = [for index, cluster in local.native_cleanup_clusters : {
    Sid       = "NativeCleanup${index}", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"],
    Resource  = "${replace(cluster, ":cluster/", ":task/")}/*",
    Condition = { ArnEquals = { "ecs:cluster" = cluster } }
  }]
  native_cleanup_endpoint_statements = [for s in local.native_cleanup_task_statements : merge(s, {
    Principal = "*", Condition = { ArnEquals = merge(s.Condition.ArnEquals, {
      "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.native_cleanup_name}"
    }) }
  })]
}
variable "native_cleanup_release" {
  description = "Reviewed immutable native-cleanup artifact; null creates nothing. No secret values."
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
    condition = var.native_cleanup_release == null ? !var.native_cleanup_enabled : (
      can(regex("^[a-f0-9]{40}$", var.native_cleanup_release.source_sha)) &&
      can(regex("^[a-f0-9]{64}$", var.native_cleanup_release.artifact_sha256)) &&
      can(regex("^[A-Za-z0-9+/]{43}=$", var.native_cleanup_release.artifact_base64sha256)) &&
      length(var.native_cleanup_release.artifact_version) > 0 && var.native_cleanup_release.artifact_version != "null" &&
      var.native_cleanup_release.artifact_key == "lambda/native-material/cleanup/${var.native_cleanup_release.source_sha}/${var.native_cleanup_release.artifact_sha256}/native-material-cleanup-worker-lambda.zip" &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.native_cleanup_release.extension_layer_arn))
    )
    error_message = "Use a complete immutable source-bound native cleanup artifact and numeric Secrets extension layer; activation requires a release."
  }
}
variable "native_cleanup_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "native_cleanup_schedule_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.native_cleanup_schedule_enabled || var.native_cleanup_enabled
    error_message = "Scheduling requires the private native cleanup runtime gate."
  }
}
locals {
  native_cleanup_deployed = var.native_cleanup_release != null
  native_cleanup_name     = "${var.name}-${var.environment}-native-material-cleanup-worker"
}
resource "aws_iam_role" "native_cleanup" {
  count                = local.native_cleanup_deployed ? 1 : 0
  name                 = local.native_cleanup_name
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "native_cleanup" {
  count = local.native_cleanup_deployed ? 1 : 0
  name  = "original-native-task-retirement"
  role  = aws_iam_role.native_cleanup[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat(local.native_cleanup_task_statements, [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${data.aws_caller_identity.current.account_id}:log-group:/ai-job-apply/${var.environment}/application:*" },
    { Effect = "Allow", Action = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.database_url.arn },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.platform.arn },
    { Effect = "Deny", Action = ["ecs:RunTask", "ecs:ExecuteCommand", "s3:*", "iam:PassRole", "lambda:InvokeFunction", "secretsmanager:PutSecretValue"], Resource = "*" }
  ]) })
}
resource "aws_lambda_function" "native_cleanup" {
  count                          = local.native_cleanup_deployed ? 1 : 0
  function_name                  = local.native_cleanup_name
  role                           = aws_iam_role.native_cleanup[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 256
  timeout                        = 240
  reserved_concurrent_executions = 1
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.native_cleanup_release.artifact_key
  s3_object_version              = var.native_cleanup_release.artifact_version
  source_code_hash               = var.native_cleanup_release.artifact_base64sha256
  layers                         = [var.native_cleanup_release.extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn
  environment {
    variables = {
      NODE_ENV                                = "production"
      RELEASE_SHA                             = var.native_cleanup_release.artifact_sha256
      PLATFORM_AWS_ACCOUNT_ID                 = data.aws_caller_identity.current.account_id
      DATABASE_SECRET_ID                      = aws_secretsmanager_secret.database_url.arn
      PARAMETERS_SECRETS_EXTENSION_LOG_LEVEL  = "ERROR"
      NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED   = tostring(var.native_cleanup_enabled)
      NATIVE_APPLICATION_DISPOSAL_ENABLED     = tostring(var.native_cleanup_enabled)
      NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS = jsonencode([for d in var.native_cleanup_deployments : { clusterArn = d.cluster_arn, taskDefinitionArn = d.task_definition_arn, containerName = d.container_name }])
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
  depends_on = [aws_iam_role_policy.native_cleanup, aws_vpc_endpoint.secretsmanager, aws_secretsmanager_secret_version.database_url]
  lifecycle {
    precondition {
      condition     = var.persistent_data_plane_enabled && data.aws_region.current.region == "us-east-2" && length(var.native_cleanup_deployments) > 0
      error_message = "Native cleanup requires the owning persistent database in us-east-2."
    }
  }
}
resource "aws_cloudwatch_event_rule" "native_cleanup" {
  count               = local.native_cleanup_deployed ? 1 : 0
  name                = local.native_cleanup_name
  schedule_expression = "rate(1 minute)"
  state               = var.native_cleanup_schedule_enabled ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "native_cleanup" {
  count     = local.native_cleanup_deployed ? 1 : 0
  rule      = aws_cloudwatch_event_rule.native_cleanup[0].name
  target_id = "bounded-native-cleanup"
  arn       = aws_lambda_function.native_cleanup[0].qualified_arn
  input     = jsonencode({ schemaVersion = 1, action = "drain" })
  retry_policy { maximum_retry_attempts = 0 }
}
resource "aws_lambda_permission" "native_cleanup" {
  count          = local.native_cleanup_deployed ? 1 : 0
  statement_id   = "ExactNativeCleanupRule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.native_cleanup[0].function_name
  qualifier      = aws_lambda_function.native_cleanup[0].version
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.native_cleanup[0].arn
  source_account = data.aws_caller_identity.current.account_id
}
resource "aws_cloudwatch_metric_alarm" "native_cleanup" {
  for_each            = local.native_cleanup_deployed ? { execution = { namespace = "AWS/Lambda", metric = "Errors", dimensions = { FunctionName = local.native_cleanup_name } }, delivery = { namespace = "AWS/Events", metric = "FailedInvocations", dimensions = { RuleName = local.native_cleanup_name } } } : {}
  alarm_name          = "${local.native_cleanup_name}-${each.key}"
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
  alarm_description   = "Native cleanup failed; inspect sanitized errors and retained queue leases. Never infer task retirement from failed delivery."
}
output "native_cleanup_function_arn" {
  value = local.native_cleanup_deployed ? aws_lambda_function.native_cleanup[0].qualified_arn : null
}
