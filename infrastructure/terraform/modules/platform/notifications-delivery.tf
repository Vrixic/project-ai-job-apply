locals {
  notifications_dispatch_rule_name = "${var.name}-${var.environment}-notifications-dispatch"
  notifications_dispatch_rule_arn = (
    "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.notifications_dispatch_rule_name}"
  )
  notifications_email_enabled = var.notifications_delivery_enabled && var.notifications_email_identity != ""
  notifications_push_enabled  = var.notifications_delivery_enabled && var.notifications_vapid_secret_provisioned
  # The bare mailbox inside "Name <address>", or the whole value when no display name is used.
  notifications_from_address = try(regex("<([^>]+)>", var.notifications_email_from)[0], var.notifications_email_from)
  notifications_ses_identity_arn = local.notifications_email_enabled ? (
    "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/${var.notifications_email_identity}"
  ) : ""
  notifications_ses_configuration_set_arn = local.notifications_email_enabled ? (
    "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:configuration-set/${var.name}-${var.environment}-notifications"
  ) : ""
  # Reaches the activity Lambda only while delivery is enabled (ADR-056).
  notifications_activity_environment = var.notifications_delivery_enabled ? merge(
    {
      NOTIFICATIONS_DISPATCH_RULE_ARN = local.notifications_dispatch_rule_arn
      NOTIFICATIONS_WEB_BASE_URL      = var.notifications_web_base_url
    },
    local.notifications_email_enabled ? {
      NOTIFICATIONS_EMAIL_FROM            = var.notifications_email_from
      NOTIFICATIONS_SES_CONFIGURATION_SET = aws_sesv2_configuration_set.notifications[0].configuration_set_name
    } : {},
    local.notifications_push_enabled ? {
      NOTIFICATIONS_VAPID_SECRET_ID = aws_secretsmanager_secret.notifications_vapid[0].arn
    } : {}
  ) : {}
}

# The sender identity. A domain identity returns DKIM tokens whose DNS records the owner adds; an
# address identity is confirmed by a link SES emails to it. Leaving the SES sandbox is an owner
# step in AWS Support, not something Terraform can do.
resource "aws_sesv2_configuration_set" "notifications" {
  count                  = local.notifications_email_enabled ? 1 : 0
  configuration_set_name = "${var.name}-${var.environment}-notifications"

  delivery_options {
    tls_policy = "REQUIRE"
  }
  reputation_options {
    reputation_metrics_enabled = true
  }
  sending_options {
    sending_enabled = true
  }
}

resource "aws_sesv2_email_identity" "notifications" {
  count                  = local.notifications_email_enabled ? 1 : 0
  email_identity         = var.notifications_email_identity
  configuration_set_name = aws_sesv2_configuration_set.notifications[0].configuration_set_name
}

# Operator-populated: {"publicKey":"...","privateKeyPem":"...","subject":"mailto:..."}. Terraform
# creates the container only, so no key material ever enters state or plans.
resource "aws_secretsmanager_secret" "notifications_vapid" {
  count                   = var.notifications_vapid_secret_provisioned ? 1 : 0
  name                    = "${var.name}/${var.environment}/notifications/vapid"
  description             = "Operator-populated Web Push VAPID identity: publicKey, privateKeyPem and subject"
  kms_key_id              = aws_kms_key.platform.arn
  recovery_window_in_days = 30
  tags = {
    "ai-job-apply:generated-synthetic-only" = "true"
  }
}

resource "aws_cloudwatch_event_rule" "notifications_dispatch" {
  count               = var.notifications_delivery_enabled ? 1 : 0
  name                = local.notifications_dispatch_rule_name
  description         = "Serve email confirmation codes and send due email and push notifications"
  schedule_expression = "rate(1 minute)"
  state               = var.serverless_runtime_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "notifications_dispatch" {
  count     = var.notifications_delivery_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.notifications_dispatch[0].name
  target_id = "notifications-dispatch"
  arn       = aws_lambda_alias.profile_readiness_activity[0].arn

  dead_letter_config {
    arn = aws_sqs_queue.profile_readiness_dead_letter[0].arn
  }
  retry_policy {
    maximum_event_age_in_seconds = 300
    maximum_retry_attempts       = 0
  }
}

resource "aws_lambda_permission" "notifications_dispatch" {
  count         = var.notifications_delivery_enabled ? 1 : 0
  statement_id  = "AllowExactNotificationsDispatchRule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.profile_readiness_activity[0].function_name
  qualifier     = aws_lambda_alias.profile_readiness_activity[0].name
  principal     = "events.amazonaws.com"
  source_arn    = local.notifications_dispatch_rule_arn
}

data "aws_iam_policy_document" "notifications_delivery" {
  count = var.notifications_delivery_enabled ? 1 : 0

  dynamic "statement" {
    for_each = local.notifications_email_enabled ? [true] : []
    content {
      sid     = "SendNotificationEmailFromTheReviewedIdentityOnly"
      effect  = "Allow"
      actions = ["ses:SendEmail"]
      resources = [
        local.notifications_ses_identity_arn,
        local.notifications_ses_configuration_set_arn,
      ]
      condition {
        test     = "StringEquals"
        variable = "ses:FromAddress"
        values   = [local.notifications_from_address]
      }
    }
  }

  dynamic "statement" {
    for_each = local.notifications_push_enabled ? [true] : []
    content {
      sid       = "ReadNotificationsVapidSecret"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [aws_secretsmanager_secret.notifications_vapid[0].arn]
    }
  }

  dynamic "statement" {
    for_each = local.notifications_push_enabled ? [true] : []
    content {
      sid       = "DecryptNotificationsSecretThroughSecretsManagerOnly"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = [aws_kms_key.platform.arn]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role_policy" "notifications_delivery" {
  count  = var.notifications_delivery_enabled ? 1 : 0
  name   = "notifications-delivery-runtime"
  role   = aws_iam_role.profile_readiness_activity[0].id
  policy = data.aws_iam_policy_document.notifications_delivery[0].json
}

output "notifications_ses_dkim_tokens" {
  description = "DKIM tokens whose CNAME records (<token>._domainkey.<domain> to <token>.dkim.amazonses.com) the owner adds to the sender domain's DNS."
  value       = local.notifications_email_enabled ? try(aws_sesv2_email_identity.notifications[0].dkim_signing_attributes[0].tokens, []) : []
}
