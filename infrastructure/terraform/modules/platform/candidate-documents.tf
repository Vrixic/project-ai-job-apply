locals {
  candidate_document_prefix = "quarantine/"

  document_processor_role_name            = "${var.name}-${var.environment}-document-processor"
  document_processor_role_arn             = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.document_processor_role_name}"
  document_parser_role_name               = "${var.name}-${var.environment}-document-parser"
  document_parser_role_arn                = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.document_parser_role_name}"
  document_parser_object_access_role_name = "${var.name}-${var.environment}-document-object-access"
  document_parser_object_access_role_arn  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.document_parser_object_access_role_name}"

  document_scan_dead_letter_queue_name          = "${var.name}-${var.environment}-document-scan-dlq"
  document_scan_dead_letter_queue_arn           = "arn:aws:sqs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:${local.document_scan_dead_letter_queue_name}"
  document_scan_delivery_dead_letter_queue_name = "${var.name}-${var.environment}-document-scan-delivery-dlq"
  document_scan_delivery_dead_letter_queue_arn  = "arn:aws:sqs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:${local.document_scan_delivery_dead_letter_queue_name}"
  document_scan_delivery_dead_letter_queue_url  = "https://sqs.${data.aws_region.current.region}.amazonaws.com/${data.aws_caller_identity.current.account_id}/${local.document_scan_delivery_dead_letter_queue_name}"
  document_scan_results_queue_name              = "${var.name}-${var.environment}-document-scan-results"
  document_scan_results_queue_arn               = "arn:aws:sqs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:${local.document_scan_results_queue_name}"
  document_scan_results_queue_url               = "https://sqs.${data.aws_region.current.region}.amazonaws.com/${data.aws_caller_identity.current.account_id}/${local.document_scan_results_queue_name}"

  document_scan_results_rule_name        = "${var.name}-${var.environment}-document-scan-results"
  document_scan_results_rule_arn         = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.document_scan_results_rule_name}"
  document_scan_tag_failure_rule_name    = "${var.name}-${var.environment}-document-scan-tag-failure"
  document_scan_tag_failure_rule_arn     = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.document_scan_tag_failure_rule_name}"
  document_scan_plan_unhealthy_rule_name = "${var.name}-${var.environment}-document-scan-plan-unhealthy"
  document_scan_plan_unhealthy_rule_arn  = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.document_scan_plan_unhealthy_rule_name}"
  document_reconciler_rule_name          = "${var.name}-${var.environment}-document-processing-reconciler"
  document_reconciler_rule_arn           = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/${local.document_reconciler_rule_name}"

  document_parser_function_name    = "${var.name}-${var.environment}-document-parser"
  document_parser_alias_arn        = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${local.document_parser_function_name}:${var.environment}"
  document_processor_function_name = "${var.name}-${var.environment}-document-processor"
  document_processor_alias_arn     = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${local.document_processor_function_name}:${var.environment}"
}

resource "aws_s3_bucket" "candidate_documents" { # nosemgrep: semgrep-rules.terraform.aws.best-practice.aws-s3-bucket-versioning-not-enabled -- versioning is managed separately below
  count  = var.deploy_document_intake ? 1 : 0
  bucket = "${var.name}-${var.environment}-candidate-docs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "candidate_documents" {
  count  = var.deploy_document_intake ? 1 : 0
  bucket = aws_s3_bucket.candidate_documents[0].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_ownership_controls" "candidate_documents" {
  count  = var.deploy_document_intake ? 1 : 0
  bucket = aws_s3_bucket.candidate_documents[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "candidate_documents" {
  count                   = var.deploy_document_intake ? 1 : 0
  bucket                  = aws_s3_bucket.candidate_documents[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "candidate_documents" {
  count  = var.deploy_document_intake ? 1 : 0
  bucket = aws_s3_bucket.candidate_documents[0].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.platform.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_cors_configuration" "candidate_documents" {
  count  = var.deploy_document_intake && length(var.candidate_document_cors_allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.candidate_documents[0].id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST"]
    allowed_origins = var.candidate_document_cors_allowed_origins
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = 300
  }
}

data "aws_iam_policy_document" "candidate_documents" {
  count = var.deploy_document_intake ? 1 : 0

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.candidate_documents[0].arn,
      "${aws_s3_bucket.candidate_documents[0].arn}/*"
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyWrongEncryptionMode"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [aws_iam_role.guardduty_malware[0].arn]
    }
  }

  statement {
    sid       = "DenyWrongEncryptionKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [local.platform_kms_key_arn]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [aws_iam_role.guardduty_malware[0].arn]
    }
  }

  dynamic "statement" {
    for_each = local.document_parser_dark_enabled ? [1] : []
    content {
      sid       = "DenyQuarantineReadsWithoutCleanMalwareTag"
      effect    = "Deny"
      actions   = ["s3:GetObject", "s3:GetObjectVersion"]
      resources = ["${aws_s3_bucket.candidate_documents[0].arn}/${local.candidate_document_prefix}*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "StringNotEquals"
        variable = "s3:ExistingObjectTag/GuardDutyMalwareScanStatus"
        values   = ["NO_THREATS_FOUND"]
      }
      condition {
        test     = "ArnNotEquals"
        variable = "aws:PrincipalArn"
        values   = [aws_iam_role.guardduty_malware[0].arn]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "candidate_documents" {
  count  = var.deploy_document_intake ? 1 : 0
  bucket = aws_s3_bucket.candidate_documents[0].id
  policy = data.aws_iam_policy_document.candidate_documents[0].json
}

data "aws_iam_policy_document" "guardduty_malware_assume" {
  count = var.deploy_document_intake ? 1 : 0
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["malware-protection-plan.guardduty.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "guardduty_malware" {
  count                = var.deploy_document_intake ? 1 : 0
  name                 = "${var.name}-${var.environment}-document-malware-scan"
  assume_role_policy   = data.aws_iam_policy_document.guardduty_malware_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

data "aws_iam_policy_document" "guardduty_malware" {
  count = var.deploy_document_intake ? 1 : 0

  statement {
    sid     = "AllowManagedRuleToSendS3EventsToGuardDuty"
    effect  = "Allow"
    actions = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"]
    resources = [
      "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"
    ]
    condition {
      test     = "StringLike"
      variable = "events:ManagedBy"
      values   = ["malware-protection-plan.guardduty.amazonaws.com"]
    }
  }

  statement {
    sid     = "AllowGuardDutyToMonitorEventBridgeManagedRule"
    effect  = "Allow"
    actions = ["events:DescribeRule", "events:ListTargetsByRule"]
    resources = [
      "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"
    ]
  }

  statement {
    sid       = "AllowEnableS3EventBridgeEvents"
    effect    = "Allow"
    actions   = ["s3:PutBucketNotification", "s3:GetBucketNotification", "s3:ListBucket"]
    resources = [aws_s3_bucket.candidate_documents[0].arn]
  }

  statement {
    sid       = "AllowPutValidationObject"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/malware-protection-resource-validation-object"]
  }

  statement {
    sid    = "AllowQuarantineScanAndTag"
    effect = "Allow"
    actions = [
      "s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging",
      "s3:PutObjectTagging", "s3:PutObjectVersionTagging"
    ]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/${local.candidate_document_prefix}*"]
  }

  statement {
    sid       = "AllowDecryptForMalwareScan"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.platform_kms_key_arn]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["s3.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "guardduty_malware" {
  count  = var.deploy_document_intake ? 1 : 0
  name   = "candidate-document-malware-scan"
  role   = aws_iam_role.guardduty_malware[0].id
  policy = data.aws_iam_policy_document.guardduty_malware[0].json
}

resource "time_sleep" "guardduty_malware_role_propagation" {
  count           = var.deploy_document_intake ? 1 : 0
  create_duration = "15s"
  depends_on      = [aws_iam_role_policy.guardduty_malware]
}

resource "aws_guardduty_malware_protection_plan" "candidate_documents" {
  count = var.deploy_document_intake ? 1 : 0
  role  = aws_iam_role.guardduty_malware[0].arn

  protected_resource {
    s3_bucket {
      bucket_name     = aws_s3_bucket.candidate_documents[0].id
      object_prefixes = [local.candidate_document_prefix]
    }
  }

  actions {
    tagging { status = "ENABLED" }
  }

  depends_on = [
    aws_s3_bucket_policy.candidate_documents,
    aws_s3_bucket_versioning.candidate_documents,
    time_sleep.guardduty_malware_role_propagation
  ]
}

resource "aws_sqs_queue" "document_scan_dead_letter" {
  count                     = local.document_parser_dark_enabled ? 1 : 0
  name                      = local.document_scan_dead_letter_queue_name
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn
}

resource "aws_sqs_queue" "document_scan_delivery_dead_letter" {
  count                     = local.document_parser_dark_enabled ? 1 : 0
  name                      = local.document_scan_delivery_dead_letter_queue_name
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn
}

resource "aws_sqs_queue" "document_scan_results" {
  count                      = local.document_parser_dark_enabled ? 1 : 0
  name                       = local.document_scan_results_queue_name
  message_retention_seconds  = 345600
  visibility_timeout_seconds = 360
  kms_master_key_id          = aws_kms_key.platform.arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = local.document_scan_dead_letter_queue_arn
    maxReceiveCount     = 5
  })

  depends_on = [aws_sqs_queue.document_scan_dead_letter]
}

resource "aws_cloudwatch_event_rule" "document_scan_results" {
  count       = local.document_parser_dark_enabled ? 1 : 0
  name        = local.document_scan_results_rule_name
  description = "Exact GuardDuty S3 malware scan results; dark until reviewed activation"
  state       = var.document_scan_event_rule_enabled ? "ENABLED" : "DISABLED"
  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Malware Protection Object Scan Result"]
    resources   = [aws_guardduty_malware_protection_plan.candidate_documents[0].arn]
    detail = {
      schemaVersion = ["1.0"]
      resourceType  = ["S3_OBJECT"]
      s3ObjectDetails = {
        bucketName = [aws_s3_bucket.candidate_documents[0].id]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "document_scan_results" {
  count     = local.document_parser_dark_enabled ? 1 : 0
  rule      = local.document_scan_results_rule_name
  target_id = "document-scan-results"
  arn       = local.document_scan_results_queue_arn

  input_transformer {
    input_paths = {
      account             = "$.account"
      bucket              = "$.detail.s3ObjectDetails.bucketName"
      event_id            = "$.id"
      object_key          = "$.detail.s3ObjectDetails.objectKey"
      object_version      = "$.detail.s3ObjectDetails.versionId"
      observed_at         = "$.time"
      protection_plan_arn = "$.resources[0]"
      region              = "$.region"
      scan_result         = "$.detail.scanResultDetails.scanResultStatus"
      scan_status         = "$.detail.scanStatus"
    }
    input_template = <<-EOT
      {"schemaVersion":1,"eventId":<event_id>,"accountId":<account>,"region":<region>,"protectionPlanArn":<protection_plan_arn>,"bucketName":<bucket>,"objectKey":<object_key>,"objectVersion":<object_version>,"scanStatus":<scan_status>,"scanResult":<scan_result>,"observedAt":<observed_at>}
    EOT
  }

  dead_letter_config { arn = local.document_scan_delivery_dead_letter_queue_arn }
  retry_policy {
    maximum_event_age_in_seconds = 300
    maximum_retry_attempts       = 2
  }

  depends_on = [
    aws_cloudwatch_event_rule.document_scan_results,
    aws_sqs_queue_policy.document_scan_results,
    aws_sqs_queue_policy.document_scan_delivery_dead_letter
  ]
}

data "aws_iam_policy_document" "document_scan_queue" {
  count = local.document_parser_dark_enabled ? 1 : 0
  statement {
    sid       = "ExactGuardDutyResultRuleOnly"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [local.document_scan_results_queue_arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [local.document_scan_results_rule_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "document_scan_results" {
  count     = local.document_parser_dark_enabled ? 1 : 0
  queue_url = local.document_scan_results_queue_url
  policy    = data.aws_iam_policy_document.document_scan_queue[0].json

  depends_on = [aws_sqs_queue.document_scan_results, aws_cloudwatch_event_rule.document_scan_results]
}

data "aws_iam_policy_document" "document_scan_delivery_dead_letter" {
  count = local.document_parser_dark_enabled ? 1 : 0
  statement {
    sid       = "ExactEventBridgeRuleDeadLettersOnly"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [local.document_scan_delivery_dead_letter_queue_arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values = [
        local.document_scan_results_rule_arn,
        local.document_scan_tag_failure_rule_arn,
        local.document_scan_plan_unhealthy_rule_arn,
        local.document_reconciler_rule_arn
      ]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "document_scan_delivery_dead_letter" {
  count     = local.document_parser_dark_enabled ? 1 : 0
  queue_url = local.document_scan_delivery_dead_letter_queue_url
  policy    = data.aws_iam_policy_document.document_scan_delivery_dead_letter[0].json

  depends_on = [
    aws_sqs_queue.document_scan_delivery_dead_letter,
    aws_cloudwatch_event_rule.document_scan_results,
    aws_cloudwatch_event_rule.document_scan_tag_failure,
    aws_cloudwatch_event_rule.document_scan_plan_unhealthy,
    aws_cloudwatch_event_rule.document_processing_reconciler
  ]
}

resource "aws_cloudwatch_event_rule" "document_scan_tag_failure" {
  count       = local.document_parser_dark_enabled ? 1 : 0
  name        = local.document_scan_tag_failure_rule_name
  description = "Exact GuardDuty post-scan tag failure for the candidate-document plan"
  state       = var.document_security_health_rules_enabled ? "ENABLED" : "DISABLED"
  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Malware Protection Post Scan Action Failed"]
    resources   = [aws_guardduty_malware_protection_plan.candidate_documents[0].arn]
    detail = {
      schemaVersion = ["1.0"]
      s3ObjectDetails = {
        bucketName = [aws_s3_bucket.candidate_documents[0].id]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "document_scan_tag_failure" {
  count     = local.document_parser_dark_enabled ? 1 : 0
  rule      = local.document_scan_tag_failure_rule_name
  target_id = "document-scan-tag-failure"
  arn       = aws_sns_topic.operational_alerts.arn
  input = jsonencode({
    event       = "document_scan_tag_failure"
    environment = var.environment
  })
  dead_letter_config { arn = local.document_scan_delivery_dead_letter_queue_arn }
  retry_policy {
    maximum_event_age_in_seconds = 300
    maximum_retry_attempts       = 2
  }

  depends_on = [
    aws_cloudwatch_event_rule.document_scan_tag_failure,
    aws_sns_topic_policy.operational_alerts,
    aws_sqs_queue_policy.document_scan_delivery_dead_letter
  ]
}

resource "aws_cloudwatch_event_rule" "document_scan_plan_unhealthy" {
  count       = local.document_parser_dark_enabled ? 1 : 0
  name        = local.document_scan_plan_unhealthy_rule_name
  description = "Exact GuardDuty candidate-document protection-plan warning or error"
  state       = var.document_security_health_rules_enabled ? "ENABLED" : "DISABLED"
  event_pattern = jsonencode({
    source = ["aws.guardduty"]
    detail-type = [
      "GuardDuty Malware Protection Resource Status Warning",
      "GuardDuty Malware Protection Resource Status Error"
    ]
    resources = [aws_guardduty_malware_protection_plan.candidate_documents[0].arn]
    detail = {
      schemaVersion = ["1.0"]
      s3BucketDetails = {
        bucketName = [aws_s3_bucket.candidate_documents[0].id]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "document_scan_plan_unhealthy" {
  count     = local.document_parser_dark_enabled ? 1 : 0
  rule      = local.document_scan_plan_unhealthy_rule_name
  target_id = "document-scan-plan-unhealthy"
  arn       = aws_sns_topic.operational_alerts.arn
  input = jsonencode({
    event       = "document_scan_plan_unhealthy"
    environment = var.environment
  })
  dead_letter_config { arn = local.document_scan_delivery_dead_letter_queue_arn }
  retry_policy {
    maximum_event_age_in_seconds = 300
    maximum_retry_attempts       = 2
  }

  depends_on = [
    aws_cloudwatch_event_rule.document_scan_plan_unhealthy,
    aws_sns_topic_policy.operational_alerts,
    aws_sqs_queue_policy.document_scan_delivery_dead_letter
  ]
}

data "aws_iam_policy_document" "document_lambda_assume" {
  count = local.document_parser_dark_enabled ? 1 : 0
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "document_processor" {
  count                = local.document_parser_dark_enabled ? 1 : 0
  name                 = local.document_processor_role_name
  assume_role_policy   = data.aws_iam_policy_document.document_lambda_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

resource "aws_iam_role" "document_parser" {
  count                = local.document_parser_dark_enabled ? 1 : 0
  name                 = local.document_parser_role_name
  assume_role_policy   = data.aws_iam_policy_document.document_lambda_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

data "aws_iam_policy_document" "document_parser_object_access_assume" {
  count = local.document_parser_dark_enabled ? 1 : 0
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = [local.document_processor_role_arn]
    }
  }
}

resource "aws_iam_role" "document_parser_object_access" {
  count                = local.document_parser_dark_enabled ? 1 : 0
  name                 = local.document_parser_object_access_role_name
  assume_role_policy   = data.aws_iam_policy_document.document_parser_object_access_assume[0].json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
  max_session_duration = 3600

  depends_on = [aws_iam_role.document_processor]
}

data "aws_iam_policy_document" "document_processor" {
  count = local.document_complete_dark_enabled ? 1 : 0
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
      "ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"
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
    sid       = "ConsumeExactScanQueue"
    effect    = "Allow"
    actions   = ["sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"]
    resources = [local.document_scan_results_queue_arn]
  }
  statement {
    sid       = "InvokeExactParserVersion"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [var.document_parser_invocation_qualified_arn]
  }
  statement {
    sid       = "AssumeExactObjectAccessRole"
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    resources = [local.document_parser_object_access_role_arn]
  }
  statement {
    sid       = "ReadNormalizedDocumentsOnly"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/normalized/*"]
  }
  statement {
    sid       = "DecryptOwnedRuntimeData"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.platform_kms_key_arn]
  }
  statement {
    sid       = "WriteNativeTraces"
    effect    = "Allow"
    actions   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
    resources = ["*"]
  }
}

data "aws_iam_policy_document" "document_parser" {
  count = local.document_parser_dark_enabled ? 1 : 0
  statement {
    sid    = "ManageVpcInterfaces"
    effect = "Allow"
    actions = [
      "ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"
    ]
    resources = ["*"]
  }
  statement {
    sid       = "DecryptLambdaEnvironment"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [local.platform_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["lambda.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "document_parser_object_access" {
  count = local.document_parser_dark_enabled ? 1 : 0
  statement {
    sid    = "SessionPolicyMustNarrowObjectAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging",
      "s3:GetObjectVersionTagging", "s3:PutObject"
    ]
    resources = [
      "${aws_s3_bucket.candidate_documents[0].arn}/quarantine/*",
      "${aws_s3_bucket.candidate_documents[0].arn}/normalized/*"
    ]
  }
  statement {
    sid       = "EncryptAndDecryptViaS3Only"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.platform_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "document_processor" {
  count  = local.document_complete_dark_enabled ? 1 : 0
  name   = "document-processor-runtime"
  role   = local.document_processor_role_name
  policy = data.aws_iam_policy_document.document_processor[0].json

  depends_on = [aws_iam_role.document_processor]
}

resource "aws_iam_role_policy" "document_parser" {
  count  = local.document_parser_dark_enabled ? 1 : 0
  name   = "document-parser-runtime"
  role   = local.document_parser_role_name
  policy = data.aws_iam_policy_document.document_parser[0].json

  depends_on = [aws_iam_role.document_parser]
}

resource "aws_iam_role_policy" "document_parser_object_access" {
  count  = local.document_parser_dark_enabled ? 1 : 0
  name   = "document-object-access-runtime"
  role   = local.document_parser_object_access_role_name
  policy = data.aws_iam_policy_document.document_parser_object_access[0].json

  depends_on = [aws_iam_role.document_parser_object_access]
}

data "aws_prefix_list" "s3" {
  count = local.document_parser_dark_enabled ? 1 : 0
  name  = "com.amazonaws.${data.aws_region.current.region}.s3"
}

resource "aws_security_group" "document_parser" {
  count       = local.document_parser_dark_enabled ? 1 : 0
  name_prefix = "${var.name}-${var.environment}-document-parser-"
  description = "No database or internet egress; exact DNS and S3 gateway only"
  vpc_id      = aws_vpc.this.id
  ingress     = []
  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [data.aws_prefix_list.s3[0].id]
  }
}

data "aws_iam_policy_document" "candidate_documents_s3_endpoint" {
  count = local.document_parser_dark_enabled ? 1 : 0
  dynamic "statement" {
    for_each = var.native_resume_normalized_buckets
    content {
      sid       = "OriginalResumeNormalizedVersion${statement.key}"
      effect    = "Allow"
      actions   = ["s3:GetObjectVersion"]
      resources = ["arn:aws:s3:::${statement.value}/normalized/*/*/*/resume.json"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values   = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-resume-source-r${statement.key}"]
      }
    }
  }

  # The candidate's own retained PDF (ADR-058): the same exact grant the source role's IAM policy carries,
  # because this endpoint allow-list would otherwise deny it. Versioned reads only, one key shape.
  dynamic "statement" {
    for_each = var.native_resume_original_pdf_buckets
    content {
      sid       = "OriginalResumeOriginalPdf${statement.key}"
      effect    = "Allow"
      actions   = ["s3:GetObjectVersion", "s3:GetObjectVersionTagging"]
      resources = ["arn:aws:s3:::${statement.value}/quarantine/*/source"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values   = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-resume-source-r${statement.key}"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.candidate_deletion_restore_role_enabled ? [1] : []
    content {
      sid       = "RestoreOnlyRetainedVersionInventory"
      effect    = "Allow"
      actions   = ["s3:ListBucketVersions"]
      resources = [aws_s3_bucket.candidate_deletion_recovery[0].arn]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values   = [local.candidate_deletion_restore_role_arn]
      }
      condition {
        test     = "StringEquals"
        variable = "s3:prefix"
        values   = [local.candidate_deletion_recovery_prefix]
      }
    }
  }
  dynamic "statement" {
    for_each = var.candidate_deletion_restore_role_enabled ? [1] : []
    content {
      sid       = "RestoreOnlyRetainedVersionReads"
      effect    = "Allow"
      actions   = ["s3:GetObjectVersion", "s3:GetObjectVersionTagging", "s3:GetObjectRetention"]
      resources = ["${aws_s3_bucket.candidate_deletion_recovery[0].arn}/${local.candidate_deletion_recovery_prefix}*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values   = [local.candidate_deletion_restore_role_arn]
      }
    }
  }
  dynamic "statement" {
    for_each = var.candidate_deletion_restore_role_enabled ? [1] : []
    content {
      sid       = "RestoreOnlyDocumentAbsenceInventory"
      effect    = "Allow"
      actions   = ["s3:ListBucketVersions"]
      resources = [aws_s3_bucket.candidate_documents[0].arn]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values   = [local.candidate_deletion_restore_role_arn]
      }
      condition {
        test     = "StringLike"
        variable = "s3:prefix"
        values   = ["quarantine/*", "normalized/*"]
      }
    }
  }
  statement {
    sid    = "ExactParserQuarantineReadsOnly"
    effect = "Allow"
    actions = [
      "s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging",
      "s3:GetObjectVersionTagging"
    ]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/quarantine/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:PrincipalArn"
      values   = [local.document_parser_object_access_role_arn]
    }
  }
  statement {
    sid       = "ExactParserNormalizedWritesAndVerification"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/normalized/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:PrincipalArn"
      values   = [local.document_parser_object_access_role_arn]
    }
  }
  statement {
    sid       = "ExactCoordinatorNormalizedReadsOnly"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.candidate_documents[0].arn}/normalized/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:PrincipalArn"
      values   = [local.document_processor_role_arn]
    }
  }

  dynamic "statement" {
    for_each = var.candidate_rights_enabled ? [1] : []
    content {
      sid    = "CandidateRightsDocumentVersionDeletion"
      effect = "Allow"
      actions = [
        "s3:ListBucketVersions", "s3:DeleteObject", "s3:DeleteObjectVersion"
      ]
      resources = [
        aws_s3_bucket.candidate_documents[0].arn,
        "${aws_s3_bucket.candidate_documents[0].arn}/*"
      ]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values   = [aws_iam_role.profile_readiness_activity[0].arn]
      }
    }
  }

  dynamic "statement" {
    for_each = var.candidate_rights_enabled ? [1] : []
    content {
      sid    = "CandidateDeletionRecoveryLedgerAccess"
      effect = "Allow"
      actions = [
        "s3:GetObject", "s3:GetObjectTagging", "s3:GetObjectVersionTagging", "s3:ListBucket", "s3:PutObject",
        "s3:PutObjectRetention", "s3:PutObjectTagging", "s3:PutObjectVersionTagging"
      ]
      resources = [
        aws_s3_bucket.candidate_deletion_recovery[0].arn,
        "${aws_s3_bucket.candidate_deletion_recovery[0].arn}/${local.candidate_deletion_recovery_prefix}*"
      ]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values = [
          aws_iam_role.profile_readiness_activity[0].arn,
          aws_iam_role.gateway_lambda[0].arn
        ]
      }
    }
  }

  dynamic "statement" {
    for_each = var.candidate_rights_enabled ? [1] : []
    content {
      sid       = "CandidateRightsExportVersionInventory"
      effect    = "Allow"
      actions   = ["s3:ListBucketVersions"]
      resources = [aws_s3_bucket.candidate_data_exports[0].arn]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values   = [aws_iam_role.profile_readiness_activity[0].arn]
      }
      condition {
        test     = "StringLike"
        variable = "s3:prefix"
        values   = ["${local.candidate_data_export_prefix}*"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.candidate_rights_enabled ? [1] : []
    content {
      sid       = "CandidateRightsExportAccess"
      effect    = "Allow"
      actions   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion", "s3:DeleteObjectVersion"]
      resources = ["${aws_s3_bucket.candidate_data_exports[0].arn}/${local.candidate_data_export_prefix}*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
      condition {
        test     = "ArnEquals"
        variable = "aws:PrincipalArn"
        values = [
          aws_iam_role.profile_readiness_activity[0].arn,
          aws_iam_role.gateway_lambda[0].arn
        ]
      }
    }
  }
}

resource "aws_vpc_endpoint" "candidate_documents_s3" {
  count             = local.document_parser_dark_enabled && var.persistent_data_plane_enabled ? 1 : 0
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id
  policy            = data.aws_iam_policy_document.candidate_documents_s3_endpoint[0].json

  depends_on = [
    aws_iam_role.document_processor,
    aws_iam_role.document_parser_object_access
  ]
}

resource "aws_lambda_function" "document_parser" {
  count                          = local.document_parser_dark_enabled ? 1 : 0
  function_name                  = local.document_parser_function_name
  description                    = "Isolated no-DB/no-internet bounded PDF and DOCX parser"
  role                           = local.document_parser_role_arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 1536
  timeout                        = 45
  reserved_concurrent_executions = 2
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.document_parser_artifact_s3_key
  s3_object_version              = var.document_parser_artifact_s3_object_version
  source_code_hash               = var.document_parser_artifact_base64sha256
  kms_key_arn                    = aws_kms_key.platform.arn

  environment {
    variables = {
      NODE_ENV                  = "production"
      RELEASE_SHA               = var.document_parser_artifact_sha256
      CANDIDATE_DOCUMENT_BUCKET = aws_s3_bucket.candidate_documents[0].id
      PLATFORM_KMS_KEY_ARN      = aws_kms_key.platform.arn
      DOCUMENT_PARSER_VERSION   = var.document_parser_version
    }
  }
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.document_parser[0].id]
  }
  ephemeral_storage { size = 512 }
  depends_on = [
    aws_iam_role_policy.document_parser,
    aws_iam_role_policy.document_parser_object_access,
    aws_vpc_endpoint.candidate_documents_s3
  ]
}

resource "aws_lambda_alias" "document_parser" {
  count            = local.document_parser_dark_enabled ? 1 : 0
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} document parser release"
  function_name    = local.document_parser_function_name
  function_version = aws_lambda_function.document_parser[0].version

  depends_on = [aws_lambda_function.document_parser]
}

resource "aws_lambda_function" "document_processor" {
  count                          = local.document_complete_dark_enabled ? 1 : 0
  function_name                  = local.document_processor_function_name
  description                    = "Identifier-only scan coordinator and atomic proposal importer"
  role                           = local.document_processor_role_arn
  runtime                        = "nodejs24.x"
  architectures                  = ["x86_64"]
  handler                        = "index.handler"
  memory_size                    = 1024
  timeout                        = 60
  reserved_concurrent_executions = 2
  publish                        = true
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  s3_key                         = var.document_processor_artifact_s3_key
  s3_object_version              = var.document_processor_artifact_s3_object_version
  source_code_hash               = var.document_processor_artifact_base64sha256
  layers                         = [var.document_processor_extension_layer_arn]
  kms_key_arn                    = aws_kms_key.platform.arn

  environment {
    variables = {
      NODE_ENV                        = "production"
      RELEASE_SHA                     = var.document_processor_artifact_sha256
      DATABASE_SECRET_ID              = aws_secretsmanager_secret.database_url.arn
      PLATFORM_AWS_ACCOUNT_ID         = data.aws_caller_identity.current.account_id
      GUARDDUTY_PROTECTION_PLAN_ARN   = aws_guardduty_malware_protection_plan.candidate_documents[0].arn
      CANDIDATE_DOCUMENT_BUCKET       = aws_s3_bucket.candidate_documents[0].id
      PLATFORM_KMS_KEY_ARN            = aws_kms_key.platform.arn
      DOCUMENT_PARSER_FUNCTION_ARN    = var.document_parser_invocation_qualified_arn
      DOCUMENT_PARSER_VERSION         = var.document_parser_version
      DOCUMENT_OBJECT_ACCESS_ROLE_ARN = local.document_parser_object_access_role_arn
      DOCUMENT_RECONCILER_RULE_ARN    = local.document_reconciler_rule_arn
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
  depends_on = [
    aws_iam_role_policy.document_processor,
    aws_vpc_endpoint.secretsmanager,
    aws_vpc_endpoint.lambda,
    aws_vpc_endpoint.sts,
    aws_vpc_endpoint.sqs,
    aws_vpc_endpoint.candidate_documents_s3,
    aws_lambda_alias.document_parser
  ]
}

resource "aws_lambda_alias" "document_processor" {
  count            = local.document_complete_dark_enabled ? 1 : 0
  name             = var.environment
  description      = "Reviewed immutable ${var.environment} document processor release"
  function_name    = local.document_processor_function_name
  function_version = aws_lambda_function.document_processor[0].version

  depends_on = [aws_lambda_function.document_processor]
}

resource "aws_lambda_event_source_mapping" "document_scan_results" {
  count                   = local.document_complete_dark_enabled ? 1 : 0
  event_source_arn        = local.document_scan_results_queue_arn
  function_name           = local.document_processor_alias_arn
  enabled                 = var.document_scan_mapping_enabled
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = 2 }
  depends_on = [
    aws_iam_role_policy.document_processor,
    aws_sqs_queue_policy.document_scan_results,
    aws_lambda_alias.document_processor
  ]
}

resource "aws_cloudwatch_event_rule" "document_processing_reconciler" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  name                = local.document_reconciler_rule_name
  description         = "Terminalize document scan and parse states that exceed bounded processing windows"
  schedule_expression = "rate(15 minutes)"
  state               = var.document_scan_mapping_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "document_processing_reconciler" {
  count     = local.document_complete_dark_enabled ? 1 : 0
  rule      = local.document_reconciler_rule_name
  target_id = "document-processing-reconciler"
  arn       = local.document_processor_alias_arn
  dead_letter_config { arn = local.document_scan_delivery_dead_letter_queue_arn }
  retry_policy {
    maximum_event_age_in_seconds = 300
    maximum_retry_attempts       = 2
  }

  depends_on = [
    aws_cloudwatch_event_rule.document_processing_reconciler,
    aws_lambda_alias.document_processor,
    aws_sqs_queue_policy.document_scan_delivery_dead_letter
  ]
}

resource "aws_lambda_permission" "document_processing_reconciler" {
  count         = local.document_complete_dark_enabled ? 1 : 0
  statement_id  = "AllowExactDocumentReconcilerRule"
  action        = "lambda:InvokeFunction"
  function_name = local.document_processor_function_name
  qualifier     = var.environment
  principal     = "events.amazonaws.com"
  source_arn    = local.document_reconciler_rule_arn

  depends_on = [aws_lambda_alias.document_processor]
}

resource "aws_cloudwatch_log_metric_filter" "document_security_contradiction" {
  count          = local.document_parser_dark_enabled ? 1 : 0
  name           = "${var.name}-${var.environment}-document-security-contradiction"
  pattern        = "{ $.message.event = \"document_processing_security_contradiction\" }"
  log_group_name = aws_cloudwatch_log_group.application.name
  metric_transformation {
    name      = "DocumentSecurityContradictions"
    namespace = local.application_metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "document_processing_record_failed" {
  count          = local.document_parser_dark_enabled ? 1 : 0
  name           = "${var.name}-${var.environment}-document-processing-record-failed"
  pattern        = "{ $.message.event = \"document_processing_record_failed\" }"
  log_group_name = aws_cloudwatch_log_group.application.name
  metric_transformation {
    name      = "DocumentProcessingRecordFailures"
    namespace = local.application_metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "document_processing_timed_out" {
  count          = local.document_parser_dark_enabled ? 1 : 0
  name           = "${var.name}-${var.environment}-document-processing-timed-out"
  pattern        = "{ $.message.event = \"document_processing_timed_out\" }"
  log_group_name = aws_cloudwatch_log_group.application.name
  metric_transformation {
    name      = "DocumentProcessingTimeouts"
    namespace = local.application_metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "document_scan_queue_age" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-scan-queue-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 600
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  dimensions          = { QueueName = local.document_scan_results_queue_name }
  alarm_description   = "Document scan processing is stuck. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "document_scan_dead_letter" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-scan-dlq"
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
  dimensions          = { QueueName = local.document_scan_dead_letter_queue_name }
  alarm_description   = "A document processing record exhausted bounded retries. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "document_scan_delivery_dead_letter" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-scan-delivery-dlq"
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
  dimensions          = { QueueName = local.document_scan_delivery_dead_letter_queue_name }
  alarm_description   = "A document scan, health alert, or reconciler EventBridge target delivery failed. Treat payload as sensitive. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "document_processor_errors" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-processor-errors"
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
  dimensions          = { FunctionName = local.document_processor_function_name }
  alarm_description   = "The document coordinator emitted an error. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "document_parser_errors" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-parser-errors"
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
  dimensions          = { FunctionName = local.document_parser_function_name }
  alarm_description   = "The isolated document parser emitted an error. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "document_security_contradiction" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-security-contradiction"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DocumentSecurityContradictions"
  namespace           = local.application_metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "Conflicting scan evidence put a document on security hold. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "document_processing_record_failed" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-processing-record-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DocumentProcessingRecordFailures"
  namespace           = local.application_metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "A document record entered bounded retry. Runbook: ${local.observability_runbook_url}"
}

resource "aws_cloudwatch_metric_alarm" "document_processing_timed_out" {
  count               = local.document_parser_dark_enabled ? 1 : 0
  alarm_name          = "${var.name}-${var.environment}-document-processing-timed-out"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DocumentProcessingTimeouts"
  namespace           = local.application_metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operational_alerts.arn]
  ok_actions          = [aws_sns_topic.operational_alerts.arn]
  alarm_description   = "The reconciler terminalized a document after its bounded scan or parse window. Runbook: ${local.observability_runbook_url}"
}
