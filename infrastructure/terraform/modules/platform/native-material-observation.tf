variable "native_material_observation_releases" {
  description = "Retained original cover-letter task-event failures; independent of trigger activation."
  type        = map(object({ kms_key_arn = string }))
  default     = {}
  nullable    = false
  validation {
    condition     = length(var.native_material_observation_releases) <= 4 && alltrue([for id, r in var.native_material_observation_releases : can(regex("^[a-z0-9]{1,12}$", id)) && can(regex("^arn:aws:kms:us-east-2:${data.aws_caller_identity.current.account_id}:key/[a-f0-9-]{36}$", r.kms_key_arn))])
    error_message = "Use exact original release IDs and same-account regional keys."
  }
}
locals {
  material_event_rules  = { for id, r in var.native_material_observation_releases : id => "arn:aws:events:us-east-2:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-material-event-${id}" }
  material_failure_arns = { for id, r in var.native_material_observation_releases : id => "arn:aws:sqs:us-east-2:${data.aws_caller_identity.current.account_id}:${var.name}-${var.environment}-material-events-${id}" }
  material_event_alarms = merge({}, [for id, r in var.native_material_observation_releases : merge({
    "${id}-queued"      = { namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", statistic = "Maximum", dimensions = { QueueName = "${var.name}-${var.environment}-material-events-${id}" } }
    "${id}-delivery"    = { namespace = "AWS/Events", metric = "FailedInvocations", statistic = "Sum", dimensions = { RuleName = "${var.name}-${var.environment}-material-event-${id}" } }
    "${id}-lost-dlq"    = { namespace = "AWS/Events", metric = "InvocationsFailedToBeSentToDlq", statistic = "Sum", dimensions = { RuleName = "${var.name}-${var.environment}-material-event-${id}" } }
    "${id}-destination" = { namespace = "AWS/Lambda", metric = "DestinationDeliveryFailures", statistic = "Sum", dimensions = { FunctionName = "${var.name}-${var.environment}-material-event-${id}" } }
    }, { for actor in ["launch", "owner", "event"] : "${id}-${actor}-errors" => { namespace = "AWS/Lambda", metric = "Errors", statistic = "Sum", dimensions = { FunctionName = "${var.name}-${var.environment}-material-${actor}-${id}" } } },
  { for actor in ["launch", "owner", "event"] : "${id}-${actor}-throttles" => { namespace = "AWS/Lambda", metric = "Throttles", statistic = "Sum", dimensions = { FunctionName = "${var.name}-${var.environment}-material-${actor}-${id}" } } })]...)
}
resource "aws_sqs_queue" "native_material_events" {
  for_each                          = var.native_material_observation_releases
  name                              = "${var.name}-${var.environment}-material-events-${each.key}"
  message_retention_seconds         = 1209600
  kms_master_key_id                 = aws_kms_key.platform.arn
  kms_data_key_reuse_period_seconds = 300
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.persistent_data_plane_enabled && data.aws_region.current.region == "us-east-2" && each.value.kms_key_arn == aws_kms_key.platform.arn
      error_message = "Failure retention requires the original private data plane and platform key."
    }
  }
}
resource "aws_sqs_queue_policy" "native_material_events" {
  for_each  = var.native_material_observation_releases
  queue_url = aws_sqs_queue.native_material_events[each.key].url
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "OriginalRule", Effect = "Allow", Principal = { Service = "events.amazonaws.com" }, Action = "sqs:SendMessage", Resource = local.material_failure_arns[each.key], Condition = { ArnEquals = { "aws:SourceArn" = local.material_event_rules[each.key] }, StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } } },
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = local.material_failure_arns[each.key], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_cloudwatch_metric_alarm" "native_material_events" {
  for_each            = local.material_event_alarms
  alarm_name          = "${var.name}-${var.environment}-material-${each.key}"
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
  alarm_description   = "Investigate original material task/control failure; never infer retirement from a failed event."
}
