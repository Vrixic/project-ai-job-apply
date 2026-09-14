locals {
  d2_community_deployed = var.d2_community_runtime.deploy
  d2_community_enabled = (
    var.d2_community_runtime.deploy &&
    var.d2_community_runtime.enabled &&
    var.runtime_activation_allowed
  )
  # Maintenance pauses execution without changing activation, resource identities, or networking.
  d2_community_operational = local.d2_community_enabled && !var.d2_community_runtime.maintenance_mode
  d2_development_contributions_enabled = (
    local.d2_community_enabled &&
    var.environment == "development" &&
    var.d2_community_runtime.development_contributions_enabled
  )
  d2_development_contribution_environment = local.d2_development_contributions_enabled ? merge({
    D2_DEPLOYMENT_ENVIRONMENT            = "development"
    D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED = "true"
    }, var.d2_community_runtime.development_contribution_providers != tolist(["greenhouse"]) ? {
    D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON = jsonencode(var.d2_community_runtime.development_contribution_providers)
    } : {}, var.d2_community_runtime.development_contribution_domains != null ? {
    D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON = jsonencode(var.d2_community_runtime.development_contribution_domains)
  } : {}) : {}
  d2_policy_endpoint_enabled = (
    var.d2_community_runtime.policy_endpoint_enabled &&
    var.deploy_applications &&
    var.deploy_gateway_lambda
  )
  d2_community_schedule_function_name = "${var.name}-${var.environment}-d2-community-scheduled"
  d2_community_signal_function_name   = "${var.name}-${var.environment}-d2-trust-signal"
  d2_community_schedule_rule_name     = "${var.name}-${var.environment}-d2-community-batch"
  d2_community_schedule_rule_arn      = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.d2_community_schedule_rule_name}"
  d2_trust_signal_queue_name          = "${var.name}-${var.environment}-d2-trust-signals"
  d2_trust_signal_dead_letter_name    = "${var.name}-${var.environment}-d2-trust-signals-dead-letter"
  d2_candidate_routes = {
    "POST /v1/jobs/contributions"                                   = ["jobs:contribute"]
    "GET /v1/jobs/contributions/{contributionId}"                   = ["jobs:contribute"]
    "POST /v1/jobs/contributions/{contributionId}/cancel"           = ["jobs:contribute"]
    "POST /v1/profile/ugc-contribution-consents"                    = ["jobs:contribute"]
    "POST /v1/profile/ugc-contribution-consents/{consentId}/revoke" = ["jobs:contribute"]
    "GET /v1/trust/contributions/{contributionId}"                  = ["jobs:contribute"]
    "POST /v1/trust/contributions/{contributionId}/withdraw"        = ["jobs:contribute"]
    "POST /v1/trust/contributions/{contributionId}/appeals"         = ["jobs:contribute"]
  }
  d2_private_capture_routes = {
    "POST /v1/saved-job-captures"               = ["jobs:write"]
    "GET /v1/saved-job-captures/{captureId}"    = ["jobs:read"]
    "DELETE /v1/saved-job-captures/{captureId}" = ["jobs:write"]
  }
  d2_reviewer_routes = {
    "GET /v1/admin/trust/cases"                             = ["trust:review"]
    "GET /v1/admin/trust/cases/{caseId}/evidence"           = ["trust:review"]
    "POST /v1/admin/trust/cases"                            = ["trust:review", "trust:case:open"]
    "GET /v1/admin/trust/cases/{caseId}"                    = ["trust:review"]
    "POST /v1/admin/trust/cases/{caseId}/decision"          = ["trust:review", "trust:case:decide"]
    "POST /v1/admin/trust/cases/{caseId}/takedown"          = ["trust:review", "trust:case:takedown"]
    "POST /v1/admin/trust/cases/{caseId}/appeal-resolution" = ["trust:review", "trust:appeal:resolve"]
  }
  d2_protected_routes = merge(
    local.d2_private_capture_routes,
    local.d2_candidate_routes,
    local.d2_reviewer_routes
  )
  d2_route_keys = local.d2_community_enabled ? keys(local.d2_protected_routes) : []
  d2_runtime_policy = {
    processing = {
      version                = var.d2_community_runtime.processing_policy_version
      workerId               = var.d2_community_runtime.processing_worker_id
      batchLimit             = var.d2_community_runtime.processing_batch_limit
      maxAttempts            = var.d2_community_runtime.processing_max_attempts
      claimLeaseMilliseconds = var.d2_community_runtime.processing_claim_lease_milliseconds
      retryDelayMilliseconds = var.d2_community_runtime.processing_retry_delay_milliseconds
    }
    contributionDelivery = {
      workerId               = var.d2_community_runtime.contribution_delivery_worker_id
      batchLimit             = var.d2_community_runtime.contribution_delivery_batch_limit
      maxAttempts            = var.d2_community_runtime.contribution_delivery_max_attempts
      claimLeaseMilliseconds = var.d2_community_runtime.contribution_delivery_claim_lease_milliseconds
      retryDelayMilliseconds = var.d2_community_runtime.contribution_delivery_retry_delay_milliseconds
    }
    trustDelivery = {
      workerId               = var.d2_community_runtime.trust_delivery_worker_id
      batchLimit             = var.d2_community_runtime.trust_delivery_batch_limit
      maxAttempts            = var.d2_community_runtime.trust_delivery_max_attempts
      claimLeaseMilliseconds = var.d2_community_runtime.trust_delivery_claim_lease_milliseconds
      retryDelayMilliseconds = var.d2_community_runtime.trust_delivery_retry_delay_milliseconds
    }
  }
  d2_community_scheduled_environment = local.d2_community_deployed ? merge({
    NODE_ENV                     = "production"
    RELEASE_SHA                  = var.d2_community_runtime.artifact_sha256
    DATABASE_SECRET_ID           = aws_secretsmanager_secret.database_url.arn
    D2_COMMUNITY_RUNTIME_ENABLED = tostring(local.d2_community_operational)
    D2_TRUST_SIGNAL_QUEUE_URL    = aws_sqs_queue.d2_trust_signal[0].url
    }, local.d2_community_enabled ? {
    D2_COMMUNITY_ACCOUNT_ID                               = data.aws_caller_identity.current.account_id
    D2_COMMUNITY_REGION                                   = data.aws_region.current.region
    D2_COMMUNITY_SCHEDULE_RULE_ARN                        = local.d2_community_schedule_rule_arn
    D2_TRUST_SIGNAL_QUEUE_ARN                             = aws_sqs_queue.d2_trust_signal[0].arn
    D2_COMMUNITY_RUNTIME_POLICY_JSON                      = jsonencode(local.d2_runtime_policy)
    D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED              = tostring(var.d2_community_runtime.provider_activation_allowed)
    D2_COMMUNITY_PROVIDER_SOURCES_JSON                    = var.d2_community_runtime.provider_sources_json
    D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON = var.d2_community_runtime.provider_verification_registrations_json
    D2_TRUST_REVIEWER_ASSIGNMENTS_JSON                    = var.d2_community_runtime.trust_reviewer_assignments_json
    D2_TRUST_EVIDENCE_ALLOWLIST_JSON                      = var.d2_community_runtime.trust_evidence_allowlist_json
    D2_TRUST_POLICY_VERSION                               = var.d2_community_runtime.trust_policy_version
    D2_TRUST_APPEAL_WINDOW_MILLISECONDS                   = tostring(var.d2_community_runtime.trust_appeal_window_milliseconds)
    D2_TRUST_SYSTEM_ACTOR_ID                              = var.d2_community_runtime.trust_system_actor_id
    } : {}, local.d2_development_contribution_environment,
    local.d2_community_enabled && !local.d2_development_contributions_enabled ? {
      JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON      = var.d2_community_runtime.signed_policy_json
      JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON = var.d2_community_runtime.signed_public_keys_json
    } : {}
  ) : {}
  # Terraform length counts characters, not UTF-8 bytes. Decode the base64 length
  # arithmetically, excluding padding, to count every configured key and value.
  d2_community_scheduled_environment_bytes = sum(concat([0], [
    for encoded in flatten([for key, value in local.d2_community_scheduled_environment : [base64encode(key), base64encode(value)]]) :
    length(encoded) / 4 * 3 - length(regexall("=", encoded))
  ]))
}

data "aws_iam_policy_document" "d2_community_lambda_assume" {
  count = local.d2_community_deployed ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_sqs_queue" "d2_trust_signal_dead_letter" {
  count                     = local.d2_community_deployed ? 1 : 0
  name                      = local.d2_trust_signal_dead_letter_name
  message_retention_seconds = var.d2_community_runtime.dead_letter_retention_seconds
  kms_master_key_id         = aws_kms_key.platform.arn
}

resource "aws_sqs_queue" "d2_trust_signal" {
  count                      = local.d2_community_deployed ? 1 : 0
  name                       = local.d2_trust_signal_queue_name
  visibility_timeout_seconds = var.d2_community_runtime.queue_visibility_timeout_seconds
  message_retention_seconds  = var.d2_community_runtime.queue_message_retention_seconds
  kms_master_key_id          = aws_kms_key.platform.arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.d2_trust_signal_dead_letter[0].arn
    maxReceiveCount     = var.d2_community_runtime.queue_max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "d2_trust_signal" {
  count     = local.d2_community_deployed ? 1 : 0
  queue_url = aws_sqs_queue.d2_trust_signal_dead_letter[0].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.d2_trust_signal[0].arn]
  })
}

resource "aws_iam_role" "d2_community_scheduled" {
  count                = local.d2_community_deployed ? 1 : 0
  name                 = "${var.name}-${var.environment}-d2-community-scheduled"
  assume_role_policy   = data.aws_iam_policy_document.d2_community_lambda_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

resource "aws_iam_role" "d2_trust_signal" {
  count                = local.d2_community_deployed ? 1 : 0
  name                 = "${var.name}-${var.environment}-d2-trust-signal"
  assume_role_policy   = data.aws_iam_policy_document.d2_community_lambda_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

data "aws_iam_policy_document" "d2_community_scheduled" {
  count = local.d2_community_deployed ? 1 : 0

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
    sid       = "DecryptOwnedConfiguration"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [local.platform_kms_key_arn]
  }

  statement {
    sid       = "SendExactTrustSignalQueue"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.d2_trust_signal[0].arn]
  }

  statement {
    sid       = "EncryptExactTrustSignalQueue"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.platform_kms_key_arn]
  }
}

data "aws_iam_policy_document" "d2_trust_signal" {
  count = local.d2_community_deployed ? 1 : 0

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
    sid       = "DecryptOwnedConfigurationAndQueue"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [local.platform_kms_key_arn]
  }

  statement {
    sid    = "ConsumeExactTrustSignalQueue"
    effect = "Allow"
    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage"
    ]
    resources = [aws_sqs_queue.d2_trust_signal[0].arn]
  }
}

resource "aws_iam_role_policy" "d2_community_scheduled" {
  count  = local.d2_community_deployed ? 1 : 0
  name   = "d2-community-scheduled-runtime"
  role   = aws_iam_role.d2_community_scheduled[0].id
  policy = data.aws_iam_policy_document.d2_community_scheduled[0].json
}

resource "aws_iam_role_policy" "d2_trust_signal" {
  count  = local.d2_community_deployed ? 1 : 0
  name   = "d2-trust-signal-runtime"
  role   = aws_iam_role.d2_trust_signal[0].id
  policy = data.aws_iam_policy_document.d2_trust_signal[0].json
}

resource "aws_lambda_function" "d2_community_scheduled" {
  count                          = local.d2_community_deployed ? 1 : 0
  function_name                  = local.d2_community_schedule_function_name
  description                    = "Default-dark bounded D2 contribution and Trust delivery batch"
  role                           = aws_iam_role.d2_community_scheduled[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.scheduled"
  memory_size                    = 512
  timeout                        = var.d2_community_runtime.lambda_timeout_seconds
  reserved_concurrent_executions = var.d2_community_runtime.maintenance_mode ? 0 : var.d2_community_runtime.scheduled_reserved_concurrency
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.d2_community_runtime.artifact_s3_key
  s3_object_version              = var.d2_community_runtime.artifact_s3_object_version
  source_code_hash               = var.d2_community_runtime.artifact_base64sha256
  layers                         = [var.d2_community_runtime.lambda_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn

  environment {
    variables = local.d2_community_scheduled_environment
  }

  vpc_config {
    subnet_ids = (
      local.d2_community_enabled && var.d2_community_runtime.provider_private_egress
      ? aws_subnet.ingestion_provider[*].id
      : aws_subnet.private[*].id
    )
    security_group_ids = [aws_security_group.application.id]
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "WARN"
    log_group             = aws_cloudwatch_log_group.application.name
  }

  lifecycle {
    create_before_destroy = true
    precondition {
      condition     = local.d2_community_scheduled_environment_bytes <= 4096
      error_message = "The complete scheduled D2 Lambda environment must not exceed 4096 UTF-8 bytes across all configured keys and values."
    }
  }

  depends_on = [
    aws_iam_role_policy.d2_community_scheduled,
    aws_vpc_endpoint.secretsmanager,
    aws_vpc_endpoint.sqs
  ]
}

resource "aws_lambda_alias" "d2_community_scheduled" {
  count            = local.d2_community_deployed ? 1 : 0
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} D2 scheduled runtime release"
  function_name    = aws_lambda_function.d2_community_scheduled[0].function_name
  function_version = aws_lambda_function.d2_community_scheduled[0].version
}

resource "aws_lambda_function" "d2_trust_signal" {
  count                          = local.d2_community_deployed ? 1 : 0
  function_name                  = local.d2_community_signal_function_name
  description                    = "Default-dark exact D2 Trust signal consumer"
  role                           = aws_iam_role.d2_trust_signal[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.trustSignal"
  memory_size                    = 512
  timeout                        = var.d2_community_runtime.lambda_timeout_seconds
  reserved_concurrent_executions = var.d2_community_runtime.maintenance_mode ? 0 : var.d2_community_runtime.signal_reserved_concurrency
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.d2_community_runtime.artifact_s3_key
  s3_object_version              = var.d2_community_runtime.artifact_s3_object_version
  source_code_hash               = var.d2_community_runtime.artifact_base64sha256
  layers                         = [var.d2_community_runtime.lambda_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn

  environment {
    variables = merge({
      NODE_ENV                     = "production"
      RELEASE_SHA                  = var.d2_community_runtime.artifact_sha256
      DATABASE_SECRET_ID           = aws_secretsmanager_secret.database_url.arn
      D2_COMMUNITY_RUNTIME_ENABLED = tostring(local.d2_community_operational)
      }, local.d2_community_enabled ? {
      D2_COMMUNITY_ACCOUNT_ID                = data.aws_caller_identity.current.account_id
      D2_COMMUNITY_REGION                    = data.aws_region.current.region
      D2_TRUST_SIGNAL_QUEUE_ARN              = aws_sqs_queue.d2_trust_signal[0].arn
      D2_COMMUNITY_PROCESSING_POLICY_VERSION = var.d2_community_runtime.processing_policy_version
    } : {})
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
    aws_iam_role_policy.d2_trust_signal,
    aws_vpc_endpoint.secretsmanager,
    aws_vpc_endpoint.sqs
  ]
}

resource "aws_lambda_alias" "d2_trust_signal" {
  count            = local.d2_community_deployed ? 1 : 0
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} D2 Trust signal release"
  function_name    = aws_lambda_function.d2_trust_signal[0].function_name
  function_version = aws_lambda_function.d2_trust_signal[0].version
}

resource "aws_cloudwatch_event_rule" "d2_community_schedule" {
  count               = local.d2_community_enabled ? 1 : 0
  name                = local.d2_community_schedule_rule_name
  description         = "Accountably activated bounded D2 community batch"
  schedule_expression = var.d2_community_runtime.schedule_expression
  state               = local.d2_community_operational ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "d2_community_schedule" {
  count     = local.d2_community_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.d2_community_schedule[0].name
  target_id = "d2-community-scheduled"
  arn       = aws_lambda_alias.d2_community_scheduled[0].arn
  input = jsonencode({
    schemaVersion   = 1
    action          = "run-d2-community-batch"
    scheduleRuleArn = local.d2_community_schedule_rule_arn
  })
}

resource "aws_lambda_permission" "d2_community_schedule" {
  count         = local.d2_community_enabled ? 1 : 0
  statement_id  = "AllowExactD2CommunitySchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.d2_community_scheduled[0].function_name
  qualifier     = aws_lambda_alias.d2_community_scheduled[0].name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.d2_community_schedule[0].arn
}

resource "aws_lambda_event_source_mapping" "d2_trust_signal" {
  count                              = local.d2_community_enabled ? 1 : 0
  event_source_arn                   = aws_sqs_queue.d2_trust_signal[0].arn
  function_name                      = aws_lambda_alias.d2_trust_signal[0].arn
  enabled                            = local.d2_community_operational
  batch_size                         = var.d2_community_runtime.trust_signal_batch_size
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.d2_community_runtime.signal_reserved_concurrency
  }

  depends_on = [aws_iam_role_policy.d2_trust_signal]
}

resource "aws_apigatewayv2_route" "d2_community_protected" {
  for_each = local.d2_community_enabled ? local.d2_protected_routes : {}

  api_id               = aws_apigatewayv2_api.gateway[0].id
  route_key            = each.key
  target               = "integrations/${aws_apigatewayv2_integration.gateway_lambda[0].id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.gateway[0].id
  authorization_scopes = each.value
}

resource "aws_apigatewayv2_route" "d2_contribution_policy" {
  count              = local.d2_policy_endpoint_enabled ? 1 : 0
  api_id             = aws_apigatewayv2_api.gateway[0].id
  route_key          = "GET /v1/extension/contribution-capability-policy"
  target             = "integrations/${aws_apigatewayv2_integration.gateway_lambda[0].id}"
  authorization_type = "NONE"
}

resource "aws_cloudwatch_metric_alarm" "d2_community_lambda_errors" {
  for_each = local.d2_community_deployed ? {
    scheduled    = aws_lambda_function.d2_community_scheduled[0].function_name
    trust-signal = aws_lambda_function.d2_trust_signal[0].function_name
  } : {}

  alarm_name          = "${var.name}-${var.environment}-d2-${each.key}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = var.d2_community_runtime.lambda_error_alarm_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "D2 ${each.key} Lambda errors exceeded its reviewed threshold. Runbook: ${local.observability_runbook_url}"
  dimensions          = { FunctionName = each.value }
}

resource "aws_cloudwatch_metric_alarm" "d2_community_lambda_throttles" {
  for_each = local.d2_community_deployed ? {
    scheduled    = aws_lambda_function.d2_community_scheduled[0].function_name
    trust-signal = aws_lambda_function.d2_trust_signal[0].function_name
  } : {}

  alarm_name          = "${var.name}-${var.environment}-d2-${each.key}-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = var.d2_community_runtime.lambda_throttle_alarm_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "D2 ${each.key} Lambda throttles exceeded its reviewed threshold. Runbook: ${local.observability_runbook_url}"
  dimensions          = { FunctionName = each.value }
}

resource "aws_cloudwatch_metric_alarm" "d2_community_lambda_duration" {
  for_each = local.d2_community_deployed ? {
    scheduled    = aws_lambda_function.d2_community_scheduled[0].function_name
    trust-signal = aws_lambda_function.d2_trust_signal[0].function_name
  } : {}

  alarm_name          = "${var.name}-${var.environment}-d2-${each.key}-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 60
  extended_statistic  = "p95"
  threshold           = var.d2_community_runtime.lambda_duration_alarm_threshold_milliseconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "D2 ${each.key} Lambda duration exceeded its reviewed threshold. Runbook: ${local.observability_runbook_url}"
  dimensions          = { FunctionName = each.value }
}

resource "aws_cloudwatch_metric_alarm" "d2_community_application_failures" {
  for_each = local.d2_community_deployed ? toset([
    "ScheduledBatchFailed",
    "JobsDead",
    "JobsDeliveryDead",
    "TrustDeliveryDead",
    "TrustSignalFailed"
  ]) : toset([])

  alarm_name          = "${var.name}-${var.environment}-d2-${lower(each.value)}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = each.value
  namespace           = "AIJobApply/D2Community"
  period              = 60
  statistic           = "Sum"
  threshold           = var.d2_community_runtime.application_failure_alarm_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "D2 aggregate ${each.value} exceeded its reviewed actionable-failure threshold. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "d2_trust_signal_queue_age" {
  count               = local.d2_community_deployed ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-d2-trust-signal-queue-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = var.d2_community_runtime.queue_age_alarm_threshold_seconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "D2 Trust signal processing is behind its reviewed age threshold. Runbook: ${local.observability_runbook_url}"
  dimensions          = { QueueName = aws_sqs_queue.d2_trust_signal[0].name }
}

resource "aws_cloudwatch_metric_alarm" "d2_trust_signal_dead_letter" {
  count               = local.d2_community_deployed ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-d2-trust-signal-dead-letter"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = var.d2_community_runtime.dead_letter_alarm_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "A D2 Trust signal exhausted the reviewed retry boundary. Runbook: ${local.observability_runbook_url}"
  dimensions          = { QueueName = aws_sqs_queue.d2_trust_signal_dead_letter[0].name }
}
