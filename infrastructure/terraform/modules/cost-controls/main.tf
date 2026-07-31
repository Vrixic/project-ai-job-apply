data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  export_name = "${var.name}-${var.environment}-cost-and-usage"
}

resource "aws_s3_bucket" "cost_exports" { # nosemgrep: semgrep-rules.terraform.aws.best-practice.aws-s3-bucket-versioning-not-enabled -- versioning is managed separately
  bucket        = "${var.name}-${var.environment}-${data.aws_caller_identity.current.account_id}-cost-exports"
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "cost_exports" {
  bucket                  = aws_s3_bucket.cost_exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  rule {
    id     = "retain-cost-evidence"
    status = "Enabled"

    filter {}

    expiration {
      days = var.export_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  depends_on = [aws_s3_bucket_versioning.cost_exports]
}

data "aws_iam_policy_document" "cost_exports" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.cost_exports.arn, "${aws_s3_bucket.cost_exports.arn}/*"]

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
    sid       = "AllowAwsDataExportsDelivery"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.cost_exports.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["bcm-data-exports.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:bcm-data-exports:us-east-1:${data.aws_caller_identity.current.account_id}:export/*"]
    }
  }
}

resource "aws_s3_bucket_policy" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id
  policy = data.aws_iam_policy_document.cost_exports.json
}

resource "aws_budgets_budget" "monthly_cost" {
  provider = aws.billing

  name         = "${var.name}-${var.environment}-monthly-cost"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_amount_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = false
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_amortized              = false
    use_blended                = false
  }

  dynamic "notification" {
    for_each = toset(var.actual_cost_alerts_usd)

    content {
      comparison_operator       = "GREATER_THAN"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [var.operational_alert_topic_arn]
      threshold                 = notification.value
      threshold_type            = "ABSOLUTE_VALUE"
    }
  }
}

resource "aws_bcmdataexports_export" "cost_and_usage" {
  provider = aws.billing

  export {
    name        = local.export_name
    description = "Daily resource-attributed CUR 2.0 evidence for ${var.name} ${var.environment}."

    data_query {
      query_statement = "SELECT identity_line_item_id, identity_time_interval, line_item_product_code, line_item_usage_type, line_item_operation, line_item_resource_id, line_item_unblended_cost FROM COST_AND_USAGE_REPORT"
      table_configurations = {
        COST_AND_USAGE_REPORT = {
          TIME_GRANULARITY                      = "DAILY"
          INCLUDE_RESOURCES                     = "TRUE"
          INCLUDE_MANUAL_DISCOUNT_COMPATIBILITY = "FALSE"
          INCLUDE_SPLIT_COST_ALLOCATION_DATA    = "FALSE"
        }
      }
    }

    destination_configurations {
      s3_destination {
        s3_bucket = aws_s3_bucket.cost_exports.bucket
        s3_prefix = "cur-2"
        s3_region = data.aws_region.current.name

        s3_output_configurations {
          compression = "PARQUET"
          format      = "PARQUET"
          output_type = "CUSTOM"
          overwrite   = "OVERWRITE_REPORT"
        }
      }
    }

    refresh_cadence {
      frequency = "SYNCHRONOUS"
    }
  }

  depends_on = [
    aws_s3_bucket_ownership_controls.cost_exports,
    aws_s3_bucket_policy.cost_exports,
    aws_s3_bucket_server_side_encryption_configuration.cost_exports,
    aws_s3_bucket_versioning.cost_exports
  ]
}
