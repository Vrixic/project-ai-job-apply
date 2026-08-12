locals {
  candidate_document_prefix = "quarantine/"
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
      values   = [aws_kms_key.platform.arn]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [aws_iam_role.guardduty_malware[0].arn]
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
    resources = [aws_kms_key.platform.arn]
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
