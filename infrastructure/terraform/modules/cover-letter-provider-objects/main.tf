terraform {
  required_version = ">= 1.16.2"
}

variable "bucket_name" {
  type        = string
  nullable    = false
  description = "Exact platform candidate-document bucket; no ARN, prefix or wildcard."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "Use an exact platform bucket name containing only lowercase letters, digits and hyphens."
  }
}

variable "account_id" {
  type     = string
  nullable = false
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Use the exact twelve-digit platform account ID."
  }
}

variable "kms_key_arn" {
  type        = string
  nullable    = false
  description = "Exact same-account us-east-2 customer KMS key ARN; aliases are refused."
  validation {
    condition     = can(regex("^arn:aws:kms:us-east-2:[0-9]{12}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", var.kms_key_arn)) && startswith(var.kms_key_arn, "arn:aws:kms:us-east-2:${var.account_id}:key/")
    error_message = "Use an exact same-account us-east-2 KMS key ARN."
  }
}

locals {
  slots = {
    for slot in ["request", "dispatch", "result"] : slot =>
    "arn:aws:s3:::${var.bucket_name}/normalized/*/generation/${slot}.v1.json"
  }
  readable    = [local.slots.request, local.slots.dispatch, local.slots.result]
  replaceable = [local.slots.dispatch, local.slots.result]
  # An identity policy for the isolated provider role, not a complete execution-role policy.
  # Nothing instantiates or attaches it. Explicit denies survive additional S3 grants.
  policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadOnlyGenerationSlots"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = local.readable
      },
      {
        Sid      = "ReplaceDispatchAndResult"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = local.replaceable
      },
      {
        Sid         = "DenyS3OutsideGenerationSlots"
        Effect      = "Deny"
        Action      = ["s3:*"]
        NotResource = local.readable
      },
      {
        Sid       = "DenyOtherS3Actions"
        Effect    = "Deny"
        NotAction = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        # Scope NotAction to S3 resources; never deny unrelated model-secret, KMS or RPC ports.
        Resource = ["arn:aws:s3:::*"]
      },
      {
        Sid         = "DenyWritesOutsideReplacementSlots"
        Effect      = "Deny"
        Action      = ["s3:PutObject"]
        NotResource = local.replaceable
      },
      {
        Sid       = "DenyMissingIfMatch"
        Effect    = "Deny"
        Action    = ["s3:PutObject"]
        Resource  = local.replaceable
        Condition = { Null = { "s3:if-match" = "true" } }
      },
      {
        Sid       = "DenyNonSpecificIfMatch"
        Effect    = "Deny"
        Action    = ["s3:PutObject"]
        Resource  = local.replaceable
        Condition = { StringEquals = { "s3:if-match" = ["", "*"] } }
      },
      {
        Sid       = "DenyCopySource"
        Effect    = "Deny"
        Action    = ["s3:PutObject"]
        Resource  = local.replaceable
        Condition = { Null = { "s3:x-amz-copy-source" = "false" } }
      },
      {
        Sid       = "DenyWrongEncryptionMode"
        Effect    = "Deny"
        Action    = ["s3:PutObject"]
        Resource  = local.replaceable
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" } }
      },
      {
        Sid       = "DenyWrongEncryptionKey"
        Effect    = "Deny"
        Action    = ["s3:PutObject"]
        Resource  = local.replaceable
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = var.kms_key_arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Action    = ["s3:*"]
        Resource  = ["*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  }
}

output "policy_json" {
  description = "Unattached isolated-provider S3 identity policy. Not runtime or quiescence authority."
  value       = jsonencode(local.policy)
}
