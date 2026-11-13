variable "live_generation" {
  description = "ADR-059 live generation on Amazon Bedrock. Null creates nothing. When set, the private bedrock-runtime endpoint (while private service endpoints are retained) and the burst alarm exist, and the exact profile and foundation model ARNs are exposed for the task roles; the permission to invoke is granted to a task role only while the kill switch is on, in the native resume task module."
  type = object({
    profile_id                 = string
    foundation_model_id        = string
    destination_regions        = list(string)
    task_role_revisions        = set(string)
    task_security_group_ids    = set(string)
    burst_invocations_per_hour = optional(number, 30)
  })
  default = null
  validation {
    condition = var.live_generation == null ? true : (
      var.environment == "development" &&
      data.aws_region.current.region == "us-east-2" &&
      can(regex("^[a-z0-9]+\\.[a-z0-9.-]+$", var.live_generation.foundation_model_id)) &&
      var.live_generation.profile_id == "us.${var.live_generation.foundation_model_id}" &&
      length(var.live_generation.destination_regions) >= 1 && length(var.live_generation.destination_regions) <= 4 &&
      length(distinct(var.live_generation.destination_regions)) == length(var.live_generation.destination_regions) &&
      contains(var.live_generation.destination_regions, "us-east-2") &&
      alltrue([for region in var.live_generation.destination_regions : can(regex("^us-(east|west)-[0-9]$", region))]) &&
      length(var.live_generation.task_role_revisions) >= 1 && length(var.live_generation.task_role_revisions) <= 4 &&
      alltrue([for revision in var.live_generation.task_role_revisions : can(regex("^[1-9][0-9]{0,8}$", revision))]) &&
      length(var.live_generation.task_security_group_ids) >= 1 && length(var.live_generation.task_security_group_ids) <= 4 &&
      alltrue([for id in var.live_generation.task_security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))]) &&
      var.live_generation.burst_invocations_per_hour >= 1 && var.live_generation.burst_invocations_per_hour <= 1000
    )
    error_message = "Use the development environment in us-east-2, a US inference profile named us. plus its foundation model id, one to four distinct US destination regions including us-east-2, one to four native resume task revisions and task groups, and a burst limit from 1 to 1000."
  }
}

locals {
  live_generation_endpoint_enabled = var.live_generation != null && var.private_service_endpoints_enabled
  live_generation_profile_arn      = var.live_generation == null ? null : "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.live_generation.profile_id}"
  live_generation_foundation_model_arns = var.live_generation == null ? [] : [
    for region in sort(var.live_generation.destination_regions) : "arn:aws:bedrock:${region}::foundation-model/${var.live_generation.foundation_model_id}"
  ]
  live_generation_task_roles = var.live_generation == null ? [] : [for revision in sort(tolist(var.live_generation.task_role_revisions)) : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-native-resume-r${revision}-task"]
  # Only the native resume task roles of the reviewed revisions may call the endpoint, only to invoke (Converse) the one
  # reviewed profile and its foundation models. Every other caller and action is denied by the endpoint policy.
  live_generation_endpoint_policy = var.live_generation == null ? null : {
    Version = "2012-10-17"
    Statement = [{
      Sid       = "InvokeReviewedModelFromNativeResumeTasks"
      Effect    = "Allow"
      Principal = "*"
      Action    = ["bedrock:InvokeModel"]
      Resource  = concat([local.live_generation_profile_arn], local.live_generation_foundation_model_arns)
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.live_generation_task_roles } }
    }]
  }
}

resource "aws_security_group" "live_generation_endpoint" {
  count       = local.live_generation_endpoint_enabled ? 1 : 0
  name_prefix = "${var.name}-${var.environment}-bedrock-endpoint-"
  description = "TLS from native resume tasks to the private Bedrock runtime endpoint"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = sort(tolist(var.live_generation.task_security_group_ids))
  }
}

resource "aws_vpc_endpoint" "live_generation_runtime" {
  count               = local.live_generation_endpoint_enabled ? 1 : 0
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.bedrock-runtime"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [aws_subnet.private[0].id]
  security_group_ids  = [aws_security_group.live_generation_endpoint[0].id]
  policy              = jsonencode(local.live_generation_endpoint_policy)
}

# Billing data lags by up to a day; this is the fast signal that something other than one candidate journey is calling the
# model. The response is to turn live generation off first (the kill switch), then investigate.
resource "aws_cloudwatch_metric_alarm" "live_generation_burst" {
  count               = var.live_generation == null ? 0 : 1
  alarm_name          = "${var.name}-${var.environment}-live-generation-burst"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 3600
  threshold           = var.live_generation.burst_invocations_per_hour
  namespace           = "AWS/Bedrock"
  metric_name         = "Invocations"
  statistic           = "Sum"
  dimensions          = { ModelId = var.live_generation.profile_id }
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "More model invocations in an hour than one candidate journey explains. Turn live generation off with the kill switch first, then investigate (ADR-059)."
}

output "live_generation_profile_arn" {
  description = "Exact reviewed inference profile ARN for the native resume task role policy; null when live generation is not configured."
  value       = local.live_generation_profile_arn
}

output "live_generation_foundation_model_arns" {
  description = "Exact foundation model ARNs behind the reviewed profile, one per destination region; empty when live generation is not configured."
  value       = local.live_generation_foundation_model_arns
}
