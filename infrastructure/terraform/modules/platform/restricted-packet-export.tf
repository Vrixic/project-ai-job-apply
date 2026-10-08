variable "restricted_packet_export_enabled" {
  description = "Enable the private candidate-rights reader for encrypted Applications packet values; no packet writer or fingerprint authority."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.restricted_packet_export_enabled || (var.restricted_packet_keys_provisioned && var.candidate_rights_enabled && var.deploy_profile_readiness_durable && contains(split(",", var.candidate_rights_owner_inventory), "applications"))
    error_message = "Protected packet export requires retained packet keys and the candidate-rights activity with Applications in its accepted owner inventory."
  }
}
locals {
  packet_export_configured = var.restricted_packet_export_enabled && var.restricted_packet_keys_provisioned && var.candidate_rights_enabled && var.deploy_profile_readiness_durable
  packet_export_statements = !local.packet_export_configured ? [] : [{
    Sid       = "ActivityPacketExport", Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.restricted_packet_encryption[0].arn,
    Condition = { StringEquals = { "kms:EncryptionContext:purpose" = "restricted-application-packet.v1" } }
  }]
  packet_export_endpoint_statements = [for statement in local.packet_export_statements : merge(statement, {
    Principal = "*", Condition = merge(statement.Condition, { ArnEquals = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-profile-readiness-activity" } })
  })]
  packet_export_environment = !local.packet_export_configured ? {} : {
    RESTRICTED_PACKET_EXPORT_ENABLED      = "true"
    RESTRICTED_PACKET_ENCRYPTION_KEY_ARN  = aws_kms_key.restricted_packet_encryption[0].arn
    RESTRICTED_PACKET_FINGERPRINT_KEY_ARN = aws_kms_key.restricted_packet_fingerprint[0].arn
  }
}
resource "aws_iam_role_policy" "restricted_packet_export" {
  count  = local.packet_export_configured ? 1 : 0
  name   = "restricted-packet-export"
  role   = aws_iam_role.profile_readiness_activity[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.packet_export_statements })
}
