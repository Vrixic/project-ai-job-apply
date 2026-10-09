variable "native_preparation_releases" {
  description = "Original preparation queues/private RPC bindings. No activation flags; retain until drain."
  type = map(object({
    queue_arn                  = string
    dead_letter_arn            = string
    kms_key_arn                = string
    database_secret_arn        = string
    launcher_function_arn      = string
    packet_encryption_key_arn  = string
    packet_fingerprint_key_arn = string
    security_group_ids         = set(string)
  }))
  default  = {}
  nullable = false
  validation {
    condition = length(var.native_preparation_releases) <= 4 && alltrue([for id, r in var.native_preparation_releases :
      can(regex("^[a-z0-9]{1,12}$", id)) &&
      alltrue([for arn in [r.queue_arn, r.dead_letter_arn] : can(regex("^arn:aws:sqs:us-east-2:${data.aws_caller_identity.current.account_id}:${var.name}-${var.environment}-[A-Za-z0-9_-]+$", arn))]) && r.queue_arn != r.dead_letter_arn &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${data.aws_caller_identity.current.account_id}:secret:${var.name}/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", r.database_secret_arn)) &&
      can(regex("^arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:${var.name}-${var.environment}-[A-Za-z0-9_-]+:[1-9][0-9]{0,8}$", r.launcher_function_arn)) &&
      alltrue([for key in [r.kms_key_arn, r.packet_encryption_key_arn, r.packet_fingerprint_key_arn] : can(regex("^arn:aws:kms:us-east-2:${data.aws_caller_identity.current.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", key))]) &&
      length(distinct([r.kms_key_arn, r.packet_encryption_key_arn, r.packet_fingerprint_key_arn])) == 3 &&
      length(r.security_group_ids) > 0 && length(r.security_group_ids) <= 2 && alltrue([for sg in r.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", sg))])
    ]) && length(distinct(flatten([for r in var.native_preparation_releases : [r.queue_arn, r.dead_letter_arn]]))) == 2 * length(var.native_preparation_releases)
    error_message = "Use original release IDs, distinct same-account resources and exact private network bindings."
  }
}
locals {
  preparation_configured      = length(var.native_preparation_releases) > 0
  preparation_security_groups = sort(distinct(flatten([for r in var.native_preparation_releases : tolist(r.security_group_ids)])))
  preparation_roles           = { for id, r in var.native_preparation_releases : id => { for k in ["activity", "durable", "starter", "terminal", "reconcile"] : k => "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-prep-${k}-${id}" } }
  preparation_rules           = { for id, r in var.native_preparation_releases : id => [for k in ["terminal", "reconcile"] : "arn:aws:events:us-east-2:${data.aws_caller_identity.current.account_id}:rule/${var.name}-${var.environment}-prep-${k}-${id}"] }
  preparation_secrets         = merge({}, [for id, r in var.native_preparation_releases : { for k in ["activity", "starter", "terminal", "reconcile"] : "${id}${k}" => { role = local.preparation_roles[id][k], secret = r.database_secret_arn } }]...)
  preparation_rpc = merge({}, [for id, r in var.native_preparation_releases : {
    "${id}activity"  = { role = local.preparation_roles[id].activity, actions = ["lambda:InvokeFunction"], resources = [r.launcher_function_arn] }
    "${id}starter"   = { role = local.preparation_roles[id].starter, actions = ["lambda:InvokeFunction"], resources = ["arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:${var.name}-${var.environment}-prep-durable-${id}:*"] }
    "${id}terminal"  = { role = local.preparation_roles[id].terminal, actions = ["lambda:GetDurableExecution"], resources = ["arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:${var.name}-${var.environment}-prep-durable-${id}:*/durable-execution/*"] }
    "${id}reconcile" = { role = local.preparation_roles[id].reconcile, actions = ["lambda:GetDurableExecution"], resources = ["arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:${var.name}-${var.environment}-prep-durable-${id}:*/durable-execution/*"] }
  }]...)
  preparation_queue_access = merge({}, [for id, r in var.native_preparation_releases : {
    "${id}starter"   = { role = local.preparation_roles[id].starter, actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [r.queue_arn] }
    "${id}reconcile" = { role = local.preparation_roles[id].reconcile, actions = ["sqs:SendMessage"], resources = [r.queue_arn, r.dead_letter_arn] }
    "${id}terminal"  = { role = local.preparation_roles[id].terminal, actions = ["sqs:SendMessage"], resources = [r.dead_letter_arn] }
  }]...)
  preparation_alarms = merge({}, [for id, r in var.native_preparation_releases : merge({
    "${id}-queue-depth" = { namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", statistic = "Maximum", threshold = 100, dimensions = { QueueName = element(reverse(split(":", r.queue_arn)), 0) } }
    "${id}-queue-age"   = { namespace = "AWS/SQS", metric = "ApproximateAgeOfOldestMessage", statistic = "Maximum", threshold = 300, dimensions = { QueueName = element(reverse(split(":", r.queue_arn)), 0) } }
    "${id}-failed-work" = { namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", statistic = "Maximum", threshold = 0, dimensions = { QueueName = element(reverse(split(":", r.dead_letter_arn)), 0) } }
    }, { for kind in ["activity", "durable", "starter", "terminal", "reconcile"] : "${id}-${kind}-errors" => { namespace = "AWS/Lambda", metric = "Errors", statistic = "Sum", threshold = 0, dimensions = { FunctionName = "${var.name}-${var.environment}-prep-${kind}-${id}" } } },
    { for kind in ["activity", "durable", "starter", "terminal", "reconcile"] : "${id}-${kind}-throttles" => { namespace = "AWS/Lambda", metric = "Throttles", statistic = "Sum", threshold = 0, dimensions = { FunctionName = "${var.name}-${var.environment}-prep-${kind}-${id}" } } },
    { for kind in ["terminal", "reconcile"] : "${id}-${kind}-delivery" => { namespace = "AWS/Events", metric = "FailedInvocations", statistic = "Sum", threshold = 0, dimensions = { RuleName = "${var.name}-${var.environment}-prep-${kind}-${id}" } } },
    { for kind in ["terminal", "reconcile"] : "${id}-${kind}-failed-dlq" => { namespace = "AWS/Events", metric = "InvocationsFailedToBeSentToDlq", statistic = "Sum", threshold = 0, dimensions = { RuleName = "${var.name}-${var.environment}-prep-${kind}-${id}" } } },
  { for kind in ["terminal", "reconcile"] : "${id}-${kind}-destination" => { namespace = "AWS/Lambda", metric = "DestinationDeliveryFailures", statistic = "Sum", threshold = 0, dimensions = { FunctionName = "${var.name}-${var.environment}-prep-${kind}-${id}" } } })]...)
}
resource "aws_sqs_queue" "native_preparation_failure" {
  for_each                          = var.native_preparation_releases
  name                              = element(reverse(split(":", each.value.dead_letter_arn)), 0)
  message_retention_seconds         = 1209600
  kms_master_key_id                 = aws_kms_key.platform.arn
  kms_data_key_reuse_period_seconds = 300
  lifecycle { prevent_destroy = true }
}
resource "aws_sqs_queue" "native_preparation" {
  for_each                          = var.native_preparation_releases
  name                              = element(reverse(split(":", each.value.queue_arn)), 0)
  message_retention_seconds         = 1209600
  visibility_timeout_seconds        = 360
  kms_master_key_id                 = aws_kms_key.platform.arn
  kms_data_key_reuse_period_seconds = 300
  redrive_policy                    = jsonencode({ deadLetterTargetArn = aws_sqs_queue.native_preparation_failure[each.key].arn, maxReceiveCount = 5 })
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.persistent_data_plane_enabled && data.aws_region.current.region == "us-east-2" && each.value.kms_key_arn == aws_kms_key.platform.arn
      error_message = "Preparation requires this environment's live private data plane and platform queue key."
    }
  }
}
resource "aws_sqs_queue_redrive_allow_policy" "native_preparation" {
  for_each             = var.native_preparation_releases
  queue_url            = aws_sqs_queue.native_preparation_failure[each.key].url
  redrive_allow_policy = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [each.value.queue_arn] })
}
resource "aws_sqs_queue_policy" "native_preparation" {
  for_each  = var.native_preparation_releases
  queue_url = aws_sqs_queue.native_preparation[each.key].url
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = each.value.queue_arn, Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_sqs_queue_policy" "native_preparation_failure" {
  for_each  = var.native_preparation_releases
  queue_url = aws_sqs_queue.native_preparation_failure[each.key].url
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "OriginalRules", Effect = "Allow", Principal = { Service = "events.amazonaws.com" }, Action = "sqs:SendMessage", Resource = each.value.dead_letter_arn,
    Condition = { ArnEquals = { "aws:SourceArn" = local.preparation_rules[each.key] }, StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } } },
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = each.value.dead_letter_arn, Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_cloudwatch_metric_alarm" "native_preparation" {
  for_each            = local.preparation_alarms
  alarm_name          = "${var.name}-${var.environment}-prep-${each.key}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = each.value.threshold
  period              = 60
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "Investigate original preparation work; never regenerate or infer task retirement from a failed delivery."
}
# Private DNS sends all VPC KMS calls here. Preserve the existing direct SDK callers,
# without admitting service-mediated S3/SQS/Secrets Manager calls or unrelated keys.
locals {
  preparation_existing_kms_access = concat(
    var.restricted_answer_vault_enabled ? [{
      Sid       = "GatewayVault", Effect = "Allow", Principal = "*", Action = ["kms:Encrypt", "kms:Decrypt"], Resource = aws_kms_key.restricted_answer_vault[0].arn,
      Condition = { ArnEquals = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-gateway-lambda" }, StringEquals = { "kms:EncryptionContext:purpose" = "restricted-answer-vault-v1" } }
    }] : [],
    var.restricted_answer_export_enabled ? [{
      Sid       = "ActivityVaultExport", Effect = "Allow", Principal = "*", Action = ["kms:Decrypt"], Resource = aws_kms_key.restricted_answer_vault[0].arn,
      Condition = { ArnEquals = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-profile-readiness-activity" }, StringEquals = { "kms:EncryptionContext:purpose" = "restricted-answer-vault-v1" } }
    }] : [],
    var.candidate_rights_enabled ? [for actor, actions in { "gateway-lambda" = ["kms:Encrypt"], "profile-readiness-activity" = ["kms:Encrypt", "kms:Decrypt"] } : {
      Sid                                                                    = actor == "gateway-lambda" ? "GatewayDeletionLocator" : "ActivityDeletionLocator", Effect = "Allow", Principal = "*", Action = actions, Resource = aws_kms_key.platform.arn,
      Condition                                                              = { ArnEquals = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-${actor}" }, StringEquals = { "kms:EncryptionContext:purpose" = "candidate-deletion-recovery-v1" } }
    }] : [],
    var.candidate_deletion_restore_role_enabled ? [{
      Sid       = "RestoreDeletionLocator", Effect = "Allow", Principal = "*", Action = ["kms:Decrypt"], Resource = aws_kms_key.platform.arn,
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.candidate_deletion_restore_role_arn }, StringEquals = { "kms:EncryptionContext:purpose" = "candidate-deletion-recovery-v1" } }
    }] : []
  )
}
resource "aws_vpc_endpoint" "native_preparation_kms" {
  count               = var.private_service_endpoints_enabled && (local.preparation_configured || var.gateway_native_materials != null || local.packet_export_configured || local.legacy_receipt_transition_configured) && var.persistent_data_plane_enabled ? 1 : 0
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.kms"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [aws_subnet.private[0].id]
  security_group_ids  = concat(aws_security_group.secrets_endpoint[*].id, local.legacy_receipt_transition_configured ? aws_security_group.migration_aws_endpoints[*].id : [])
  policy = jsonencode({ Version = "2012-10-17", Statement = concat(local.preparation_existing_kms_access, local.legacy_receipt_endpoint_statements, local.gateway_packet_endpoint_statements, local.packet_export_endpoint_statements, flatten([for id, r in var.native_preparation_releases : [
    { Effect = "Allow", Principal = "*", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = r.packet_encryption_key_arn, Condition = { ArnEquals = { "aws:PrincipalArn" = local.preparation_roles[id].activity } } },
    { Effect = "Allow", Principal = "*", Action = ["kms:GenerateMac"], Resource = r.packet_fingerprint_key_arn, Condition = { ArnEquals = { "aws:PrincipalArn" = local.preparation_roles[id].activity } } }
  ]])) })
}
