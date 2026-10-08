# Original release failure retention; independent of runtime activation.
variable "native_resume_observation_releases" {
  type     = map(object({ queue_arn = string, kms_key_arn = string, reconciliation_enabled = optional(bool, false) }))
  default  = {}
  nullable = false
  validation {
    condition = alltrue([for revision, release in var.native_resume_observation_releases :
      can(regex("^[1-9][0-9]{0,8}$", revision)) &&
      can(regex("^arn:aws:sqs:us-east-2:${data.aws_caller_identity.current.account_id}:${var.name}-${var.environment}-[A-Za-z0-9_-]+$", release.queue_arn))
    ]) && length(distinct([for release in values(var.native_resume_observation_releases) : release.queue_arn])) == length(var.native_resume_observation_releases)
    error_message = "Each original revision needs a distinct same-account/environment standard queue."
  }
}
locals {
  native_resume_reconciliation_releases   = { for revision, r in var.native_resume_observation_releases : revision => r if r.reconciliation_enabled }
  native_resume_reconciliation_configured = length(local.native_resume_reconciliation_releases) > 0
  native_resume_sweep_rules               = { for revision, r in var.native_resume_observation_releases : revision => "arn:aws:events:us-east-2:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-resume-observer-r${revision}-sweep" }
  native_resume_execution_rules           = { for revision, r in var.native_resume_observation_releases : revision => "arn:aws:events:us-east-2:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-resume-observer-r${revision}-executions" }

  native_resume_terminal_rules = { for revision, release in var.native_resume_observation_releases : revision => "arn:aws:events:us-east-2:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-resume-durable-r${revision}-terminal" }
  native_resume_observer_rules = { for revision, release in var.native_resume_observation_releases : revision => "arn:aws:events:us-east-2:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-resume-observer-r${revision}" }
  native_resume_observer_alarms = merge({}, [for revision, release in var.native_resume_observation_releases : {
    "${revision}-terminal-delivery" = { namespace = "AWS/Events", metric = "FailedInvocations", statistic = "Sum", dimensions = { RuleName = "${var.name}-${var.environment}-resume-durable-r${revision}-terminal" } }
    "${revision}-durable-failed"    = { namespace = "AWS/Lambda", metric = "DurableExecutionFailed", statistic = "Sum", dimensions = { FunctionName = "${var.name}-${var.environment}-resume-durable-r${revision}" } }
    "${revision}-durable-timeout"   = { namespace = "AWS/Lambda", metric = "DurableExecutionTimedOut", statistic = "Sum", dimensions = { FunctionName = "${var.name}-${var.environment}-resume-durable-r${revision}" } }
    "${revision}-queued"            = { namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", statistic = "Maximum", dimensions = { QueueName = element(reverse(split(":", release.queue_arn)), 0) } }
    "${revision}-delivery"          = { namespace = "AWS/Events", metric = "InvocationsFailedToBeSentToDlq", statistic = "Sum", dimensions = { RuleName = "${var.name}-${var.environment}-resume-observer-r${revision}" } }
    "${revision}-sweep"             = { namespace = "AWS/Events", metric = "FailedInvocations", statistic = "Sum", dimensions = { RuleName = "${var.name}-${var.environment}-resume-observer-r${revision}-sweep" } }
    "${revision}-execution"         = { namespace = "AWS/Lambda", metric = "DeadLetterErrors", statistic = "Sum", dimensions = { FunctionName = "${var.name}-${var.environment}-resume-observer-r${revision}" } }
  }]...)
}
resource "aws_sqs_queue" "native_resume_observation" {
  for_each                          = var.native_resume_observation_releases
  name                              = element(reverse(split(":", each.value.queue_arn)), 0)
  message_retention_seconds         = 1209600
  visibility_timeout_seconds        = 60
  kms_master_key_id                 = aws_kms_key.platform.arn
  kms_data_key_reuse_period_seconds = 300
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = each.value.kms_key_arn == aws_kms_key.platform.arn && data.aws_region.current.region == "us-east-2"
      error_message = "Observation failure retention must use this environment's platform key in us-east-2."
    }
  }
}
resource "aws_sqs_queue_policy" "native_resume_observation" {
  for_each  = var.native_resume_observation_releases
  queue_url = aws_sqs_queue.native_resume_observation[each.key].url
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "OriginalRuleOnly", Effect = "Allow", Principal = { Service = "events.amazonaws.com" }, Action = "sqs:SendMessage", Resource = each.value.queue_arn,
    Condition = { ArnEquals = { "aws:SourceArn" = [local.native_resume_observer_rules[each.key], local.native_resume_terminal_rules[each.key], local.native_resume_sweep_rules[each.key], local.native_resume_execution_rules[each.key]] }, StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } } },
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = each.value.queue_arn,
    Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_cloudwatch_metric_alarm" "native_resume_observation" {
  for_each            = local.native_resume_observer_alarms
  alarm_name          = "${var.name}-${var.environment}-resume-observer-${each.key}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 60
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "Original resume observation needs investigation; never infer retirement from a failed event. See native-resume-preparation README."
}

resource "aws_cloudwatch_metric_alarm" "native_resume_execution_reconciliation" {
  for_each = merge({}, [for revision, r in local.native_resume_reconciliation_releases : {
    "${revision}-invocation" = { namespace = "AWS/Lambda", metric = "Errors", dimensions = { FunctionName = "${var.name}-${var.environment}-resume-observer-r${revision}" } }
    "${revision}-delivery"   = { namespace = "AWS/Events", metric = "FailedInvocations", dimensions = { RuleName = "${var.name}-${var.environment}-resume-observer-r${revision}-executions" } }
    "${revision}-dlq"        = { namespace = "AWS/Events", metric = "InvocationsFailedToBeSentToDlq", dimensions = { RuleName = "${var.name}-${var.environment}-resume-observer-r${revision}-executions" } }
  }]...)
  alarm_name          = "${var.name}-${var.environment}-resume-execution-${each.key}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 60
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = "Sum"
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "Original execution receipt scan failed; inspect retained original failures without relaunch or regeneration."
}
