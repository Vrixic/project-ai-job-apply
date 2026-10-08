variable "restricted_packet_keys_provisioned" {
  description = "Provision retained packet encryption/fingerprint keys without enabling a caller or preparation release."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.restricted_packet_keys_provisioned || (var.persistent_data_plane_enabled && data.aws_region.current.region == "us-east-2")
    error_message = "Packet keys require the retained us-east-2 data plane."
  }
}
locals {
  restricted_packet_key_delegation = {
    Sid = "DelegateToAccountIAM", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }, Action = "kms:*", Resource = "*"
  }
}
resource "aws_kms_key" "restricted_packet_encryption" {
  count                    = var.restricted_packet_keys_provisioned ? 1 : 0
  description              = "${var.name} ${var.environment} restricted application packet envelopes"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  key_usage                = "ENCRYPT_DECRYPT"
  deletion_window_in_days  = 30
  enable_key_rotation      = true
  policy = jsonencode({ Version = "2012-10-17", Statement = [local.restricted_packet_key_delegation, {
    Sid       = "RejectOtherPurposes", Effect = "Deny", Principal = "*", Action = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey*"], Resource = "*",
    Condition = { StringNotEquals = { "kms:EncryptionContext:purpose" = "restricted-application-packet.v1" } }
  }] })
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_key" "restricted_packet_fingerprint" {
  count                    = var.restricted_packet_keys_provisioned ? 1 : 0
  description              = "${var.name} ${var.environment} restricted application packet HMAC fingerprints"
  customer_master_key_spec = "HMAC_256"
  key_usage                = "GENERATE_VERIFY_MAC"
  deletion_window_in_days  = 30
  policy = jsonencode({ Version = "2012-10-17", Statement = [local.restricted_packet_key_delegation, {
    Sid       = "RejectOtherMacAlgorithms", Effect = "Deny", Principal = "*", Action = ["kms:GenerateMac", "kms:VerifyMac"], Resource = "*",
    Condition = { StringNotEquals = { "kms:MacAlgorithm" = "HMAC_SHA_256" } }
  }] })
  lifecycle { prevent_destroy = true }
}
output "restricted_packet_key_bindings" {
  description = "Exact key ARNs for reviewed release/bootstrap inputs; provisioning does not grant a caller access."
  value = var.restricted_packet_keys_provisioned ? {
    encryption_key_arn  = aws_kms_key.restricted_packet_encryption[0].arn
    fingerprint_key_arn = aws_kms_key.restricted_packet_fingerprint[0].arn
  } : null
}
