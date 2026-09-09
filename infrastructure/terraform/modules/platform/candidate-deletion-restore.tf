locals {
  candidate_deletion_restore_role_name = "${var.name}-${var.environment}-deletion-restore"
  candidate_deletion_restore_role_arn  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.candidate_deletion_restore_role_name}"
}

variable "candidate_deletion_restore_role_enabled" {
  description = "Create only the development restore-only read role; never creates a Lambda, restore, trigger, or live rights permission. Activation requires separate review."
  type        = bool
  default     = false

  validation {
    condition = !var.candidate_deletion_restore_role_enabled || (
      var.environment == "development" && var.persistent_data_plane_enabled &&
      var.candidate_rights_enabled && var.deploy_profile_readiness_durable &&
      var.deploy_document_intake && local.document_parser_dark_enabled
    )
    error_message = "The restore-only role requires the existing private development database and candidate-rights/document runtime; it cannot provision or activate those prerequisites."
  }
}

resource "aws_iam_role" "candidate_deletion_restore" {
  count                = var.candidate_deletion_restore_role_enabled ? 1 : 0
  name                 = local.candidate_deletion_restore_role_name
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

locals {
  candidate_deletion_restore_policy = var.candidate_deletion_restore_role_enabled ? {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteOwnedLogs", Effect = "Allow",
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource = "${aws_cloudwatch_log_group.application.arn}:*"
      },
      {
        Sid      = "ManagePrivateLambdaInterfaces", Effect = "Allow",
        Action   = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"],
        Resource = "*"
      },
      {
        Sid    = "ReadExactDatabaseSecret", Effect = "Allow",
        Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.database_url.arn
      },
      {
        Sid = "DecryptExactDatabaseSecret", Effect = "Allow", Action = ["kms:Decrypt"], Resource = local.platform_kms_key_arn,
        Condition = { StringEquals = {
          "kms:ViaService"                  = "secretsmanager.${data.aws_region.current.region}.amazonaws.com",
          "kms:EncryptionContext:SecretARN" = aws_secretsmanager_secret.database_url.arn
        } }
      },
      {
        Sid       = "ListRetainedMarkerVersions", Effect = "Allow", Action = ["s3:ListBucketVersions"],
        Resource  = aws_s3_bucket.candidate_deletion_recovery[0].arn,
        Condition = { StringEquals = { "s3:prefix" = local.candidate_deletion_recovery_prefix } }
      },
      {
        Sid      = "ReadExactRetainedMarkerVersions", Effect = "Allow",
        Action   = ["s3:GetObjectVersion", "s3:GetObjectVersionTagging", "s3:GetObjectRetention"],
        Resource = "${aws_s3_bucket.candidate_deletion_recovery[0].arn}/${local.candidate_deletion_recovery_prefix}*"
      },
      {
        Sid       = "ListDocumentVersionsOnly", Effect = "Allow", Action = ["s3:ListBucketVersions"],
        Resource  = aws_s3_bucket.candidate_documents[0].arn,
        Condition = { StringLike = { "s3:prefix" = ["quarantine/*", "normalized/*"] } }
      },
      {
        Sid = "DecryptRetainedMarkerObjects", Effect = "Allow", Action = ["kms:Decrypt"], Resource = local.platform_kms_key_arn,
        Condition = {
          StringEquals = { "kms:ViaService" = "s3.${data.aws_region.current.region}.amazonaws.com" },
          StringLike   = { "kms:EncryptionContext:aws:s3:arn" = [aws_s3_bucket.candidate_deletion_recovery[0].arn, "${aws_s3_bucket.candidate_deletion_recovery[0].arn}/${local.candidate_deletion_recovery_prefix}*"] }
        }
      },
      {
        Sid = "DecryptExactRecoveryLocators", Effect = "Allow", Action = ["kms:Decrypt"], Resource = local.platform_kms_key_arn,
        Condition = {
          StringEquals                = { "kms:EncryptionContext:purpose" = "candidate-deletion-recovery-v1" },
          StringLike                  = { "kms:EncryptionContext:requestId" = "????????-????-????-????-????????????" },
          "ForAllValues:StringEquals" = { "kms:EncryptionContextKeys" = ["purpose", "requestId"] }
        }
      }
    ]
  } : null
}

resource "aws_iam_role_policy" "candidate_deletion_restore" {
  count  = var.candidate_deletion_restore_role_enabled ? 1 : 0
  name   = "candidate-deletion-restore-read-only"
  role   = aws_iam_role.candidate_deletion_restore[0].id
  policy = jsonencode(local.candidate_deletion_restore_policy)
}
