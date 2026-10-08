variable "gateway_native_materials" {
  description = "Optional native candidate API configuration. Provisioning grants packet access; all runtime switches default off."
  type = object({
    packet_protection_enabled      = optional(bool, false)
    read_authorizations_enabled    = optional(bool, false)
    cover_letter_base_host         = optional(string)
    cover_letter_locations_enabled = optional(bool, false)
    resume_base_host               = optional(string)
    resume_locations_enabled       = optional(bool, false)
    resume_preparation_enabled     = optional(bool, false)
  })
  default = null
  validation {
    condition = var.gateway_native_materials == null ? true : (
      var.restricted_packet_keys_provisioned && var.deploy_gateway_lambda &&
      alltrue([for host in [var.gateway_native_materials.cover_letter_base_host, var.gateway_native_materials.resume_base_host] : host == null ? true : (length(host) <= 200 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$", host)))]) &&
      (!var.gateway_native_materials.read_authorizations_enabled || var.gateway_native_materials.packet_protection_enabled) &&
      (!var.gateway_native_materials.cover_letter_locations_enabled || (var.gateway_native_materials.cover_letter_base_host != null && var.gateway_native_materials.read_authorizations_enabled)) &&
      (!var.gateway_native_materials.resume_locations_enabled || (var.gateway_native_materials.resume_base_host != null && var.gateway_native_materials.read_authorizations_enabled)) &&
      (!var.gateway_native_materials.resume_preparation_enabled || var.gateway_native_materials.resume_locations_enabled)
    )
    error_message = "Native candidate API requires the Gateway and retained packet keys, reviewed DNS hostnames, protection before authorization, authorization before locations and resume locations before intake."
  }
}

locals {
  gateway_native_configured = var.gateway_native_materials != null && var.restricted_packet_keys_provisioned && var.deploy_gateway_lambda
  gateway_packet_statements = !local.gateway_native_configured ? [] : [
    { Sid = "GatewayPacketEncryption", Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = aws_kms_key.restricted_packet_encryption[0].arn,
    Condition = { StringEquals = { "kms:EncryptionContext:purpose" = "restricted-application-packet.v1" } } },
    { Sid = "GatewayPacketFingerprint", Effect = "Allow", Action = ["kms:GenerateMac"], Resource = aws_kms_key.restricted_packet_fingerprint[0].arn,
    Condition = { StringEquals = { "kms:MacAlgorithm" = "HMAC_SHA_256" } } }
  ]
  gateway_packet_endpoint_statements = [for statement in local.gateway_packet_statements : merge(statement, {
    Principal = "*", Condition = merge(statement.Condition, { ArnEquals = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-gateway-lambda" } })
  })]
  gateway_native_material_environment = !local.gateway_native_configured ? {} : merge({
    RESTRICTED_PACKET_PROTECTION_ENABLED        = tostring(var.gateway_native_materials.packet_protection_enabled)
    RESTRICTED_PACKET_ENCRYPTION_KEY_ARN        = aws_kms_key.restricted_packet_encryption[0].arn
    RESTRICTED_PACKET_FINGERPRINT_KEY_ARN       = aws_kms_key.restricted_packet_fingerprint[0].arn
    NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED = tostring(var.gateway_native_materials.read_authorizations_enabled)
    NATIVE_MATERIAL_READ_LOCATIONS_ENABLED      = tostring(var.gateway_native_materials.cover_letter_locations_enabled)
    NATIVE_RESUME_READ_LOCATIONS_ENABLED        = tostring(var.gateway_native_materials.resume_locations_enabled)
    NATIVE_RESUME_PREPARATION_ENABLED           = tostring(var.gateway_native_materials.resume_preparation_enabled)
    }, var.gateway_native_materials.cover_letter_base_host == null ? {} : { NATIVE_MATERIAL_BASE_HOST = var.gateway_native_materials.cover_letter_base_host },
  var.gateway_native_materials.resume_base_host == null ? {} : { NATIVE_RESUME_BASE_HOST = var.gateway_native_materials.resume_base_host })
}
resource "aws_iam_role_policy" "gateway_native_packet" {
  count  = local.gateway_native_configured ? 1 : 0
  name   = "native-packet-protection"
  role   = aws_iam_role.gateway_lambda[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.gateway_packet_statements })
}
