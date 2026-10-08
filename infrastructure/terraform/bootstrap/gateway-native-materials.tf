variable "gateway_packet_fingerprint_key_arn" {
  description = "Optional exact retained packet HMAC key for the existing Gateway boundary. Grants no other principal or cryptographic operation."
  type        = string
  default     = null
  validation {
    condition     = var.gateway_packet_fingerprint_key_arn == null ? true : (var.aws_region == "us-east-2" && can(regex("^arn:aws:kms:us-east-2:${data.aws_caller_identity.current.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", var.gateway_packet_fingerprint_key_arn)))
    error_message = "Use the exact same-account us-east-2 packet fingerprint key ARN."
  }
}
locals {
  gateway_packet_boundary_statements = var.gateway_packet_fingerprint_key_arn == null ? [] : [{
    Sid = "GatewayPacketFingerprint", Effect = "Allow", Action = ["kms:GenerateMac"], Resource = var.gateway_packet_fingerprint_key_arn,
    Condition = {
      ArnEquals    = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-gateway-lambda" }
      StringEquals = { "kms:MacAlgorithm" = "HMAC_SHA_256" }
    }
  }]
}
