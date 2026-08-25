locals {
  candidate_data_export_prefix       = "candidate-data-exports/"
  candidate_deletion_recovery_prefix = "candidate-deletion-recovery/"
}

resource "aws_s3_bucket" "candidate_data_exports" { # nosemgrep: semgrep-rules.terraform.aws.best-practice.aws-s3-bucket-versioning-not-enabled -- managed below
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = "${var.name}-${var.environment}-candidate-exports-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "candidate_data_exports" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_data_exports[0].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_ownership_controls" "candidate_data_exports" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_data_exports[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "candidate_data_exports" {
  count                   = var.candidate_rights_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.candidate_data_exports[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "candidate_data_exports" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_data_exports[0].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.platform.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "candidate_data_exports" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_data_exports[0].id
  rule {
    id     = "expire-candidate-data-exports"
    status = "Enabled"
    filter { prefix = local.candidate_data_export_prefix }
    expiration { days = var.candidate_rights_export_lifecycle_days }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
  depends_on = [aws_s3_bucket_versioning.candidate_data_exports]
}

data "aws_iam_policy_document" "candidate_data_exports" {
  count = var.candidate_rights_enabled ? 1 : 0

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.candidate_data_exports[0].arn,
      "${aws_s3_bucket.candidate_data_exports[0].arn}/*"
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
    sid       = "DenyUnencryptedWrites"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.candidate_data_exports[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }
}

resource "aws_s3_bucket_policy" "candidate_data_exports" {
  count      = var.candidate_rights_enabled ? 1 : 0
  bucket     = aws_s3_bucket.candidate_data_exports[0].id
  policy     = data.aws_iam_policy_document.candidate_data_exports[0].json
  depends_on = [aws_s3_bucket_public_access_block.candidate_data_exports]
}

resource "aws_secretsmanager_secret" "candidate_rights_auth0" {
  count                   = var.candidate_rights_auth0_secret_provisioned ? 1 : 0
  name                    = "${var.name}/${var.environment}/candidate-rights/auth0-management"
  description             = "Operator-populated Auth0 M2M clientId, clientSecret, and explicit revocationMode"
  kms_key_id              = aws_kms_key.platform.arn
  recovery_window_in_days = 30
  tags = {
    "ai-job-apply:generated-synthetic-only" = "true"
    "ai-job-apply:authorized-owner"         = var.candidate_rights_auth0_authorized_owner
  }
}

resource "aws_s3_bucket" "candidate_deletion_recovery" { # nosemgrep: semgrep-rules.terraform.aws.best-practice.aws-s3-bucket-versioning-not-enabled -- managed below
  count               = var.candidate_rights_enabled ? 1 : 0
  bucket              = "${var.name}-${var.environment}-candidate-del-recovery-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "candidate_deletion_recovery" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_deletion_recovery[0].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_object_lock_configuration" "candidate_deletion_recovery" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_deletion_recovery[0].id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.candidate_rights_backup_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.candidate_deletion_recovery]
}

resource "aws_s3_bucket_ownership_controls" "candidate_deletion_recovery" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_deletion_recovery[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "candidate_deletion_recovery" {
  count                   = var.candidate_rights_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.candidate_deletion_recovery[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "candidate_deletion_recovery" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_deletion_recovery[0].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.platform.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "candidate_deletion_recovery" {
  count  = var.candidate_rights_enabled ? 1 : 0
  bucket = aws_s3_bucket.candidate_deletion_recovery[0].id
  rule {
    id     = "expire-aged-candidate-deletion-recovery"
    status = "Enabled"
    filter { prefix = local.candidate_deletion_recovery_prefix }
    expiration { days = var.candidate_rights_backup_retention_days + 1 }
    noncurrent_version_expiration {
      noncurrent_days = var.candidate_rights_backup_retention_days + 1
    }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
  depends_on = [aws_s3_bucket_object_lock_configuration.candidate_deletion_recovery]
}

data "aws_iam_policy_document" "candidate_deletion_recovery" {
  count = var.candidate_rights_enabled ? 1 : 0
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.candidate_deletion_recovery[0].arn,
      "${aws_s3_bucket.candidate_deletion_recovery[0].arn}/*"
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
    sid       = "DenyUnencryptedWrites"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.candidate_deletion_recovery[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }
}

resource "aws_s3_bucket_policy" "candidate_deletion_recovery" {
  count      = var.candidate_rights_enabled ? 1 : 0
  bucket     = aws_s3_bucket.candidate_deletion_recovery[0].id
  policy     = data.aws_iam_policy_document.candidate_deletion_recovery[0].json
  depends_on = [aws_s3_bucket_public_access_block.candidate_deletion_recovery]
}
