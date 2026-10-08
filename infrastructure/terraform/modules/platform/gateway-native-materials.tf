variable "gateway_native_materials" {
  description = "Optional native candidate API configuration. Provisioning grants packet access; all runtime switches default off."
  type = object({
    owner_cleanup_enabled            = optional(bool, false)
    disposal_enabled                 = optional(bool, false)
    disposal_deployments             = optional(list(object({ cluster_arn = string, task_definition_arn = string, container_name = string })), [])
    availability_enabled             = optional(bool, false)
    packet_protection_enabled        = optional(bool, false)
    read_authorizations_enabled      = optional(bool, false)
    cover_letter_base_host           = optional(string)
    cover_letter_locations_enabled   = optional(bool, false)
    resume_base_host                 = optional(string)
    resume_locations_enabled         = optional(bool, false)
    resume_preparation_enabled       = optional(bool, false)
    cover_letter_preparation_enabled = optional(bool, false)
  })
  default = null
  validation {
    condition = var.gateway_native_materials == null ? true : (
      var.restricted_packet_keys_provisioned && var.deploy_gateway_lambda &&
      (!var.gateway_native_materials.owner_cleanup_enabled || (var.gateway_native_materials.disposal_enabled && var.native_cleanup_enabled && var.native_cleanup_schedule_enabled && alltrue([for d in var.gateway_native_materials.disposal_deployments : contains(var.native_cleanup_deployments, d)]))) &&
      length(var.gateway_native_materials.disposal_deployments) <= 8 &&
      (length(var.gateway_native_materials.disposal_deployments) == 0 || var.persistent_data_plane_enabled) &&
      (!var.gateway_native_materials.disposal_enabled || length(var.gateway_native_materials.disposal_deployments) > 0) &&
      alltrue([for deployment in var.gateway_native_materials.disposal_deployments :
        can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", deployment.cluster_arn)) &&
        can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task-definition/${var.name}-${var.environment}-native-(material|resume):[1-9][0-9]{0,8}$", deployment.task_definition_arn)) &&
        contains(["native-material", "native-resume"], deployment.container_name)
      ]) &&
      (!var.gateway_native_materials.availability_enabled || (
        var.private_application_networking && var.gateway_native_materials.read_authorizations_enabled &&
        (var.gateway_native_materials.cover_letter_locations_enabled || var.gateway_native_materials.resume_locations_enabled) &&
        (!var.gateway_native_materials.cover_letter_locations_enabled || contains(keys(var.native_material_read_networks), "cover_letter")) &&
        (!var.gateway_native_materials.resume_locations_enabled || contains(keys(var.native_material_read_networks), "resume"))
      )) &&
      alltrue([for host in [var.gateway_native_materials.cover_letter_base_host, var.gateway_native_materials.resume_base_host] : host == null ? true : (length(host) <= 200 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$", host)))]) &&
      (!var.gateway_native_materials.read_authorizations_enabled || var.gateway_native_materials.packet_protection_enabled) &&
      (!var.gateway_native_materials.cover_letter_locations_enabled || (var.gateway_native_materials.cover_letter_base_host != null && var.gateway_native_materials.read_authorizations_enabled)) &&
      (!var.gateway_native_materials.resume_locations_enabled || (var.gateway_native_materials.resume_base_host != null && var.gateway_native_materials.read_authorizations_enabled)) &&
      (!var.gateway_native_materials.resume_preparation_enabled || var.gateway_native_materials.resume_locations_enabled) &&
      (!var.gateway_native_materials.cover_letter_preparation_enabled || var.gateway_native_materials.cover_letter_locations_enabled)
    )
    error_message = "Native candidate API requires the Gateway and retained packet keys, reviewed DNS hostnames, protection before authorization, authorization before locations and matching material locations before intake; availability also requires private application NAT and matching native task groups. Owner withdrawal additionally requires an enabled scheduled worker retaining every Gateway disposal deployment."
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
    RESTRICTED_PACKET_PROTECTION_ENABLED  = tostring(var.gateway_native_materials.packet_protection_enabled)
    RESTRICTED_PACKET_ENCRYPTION_KEY_ARN  = aws_kms_key.restricted_packet_encryption[0].arn
    RESTRICTED_PACKET_FINGERPRINT_KEY_ARN = aws_kms_key.restricted_packet_fingerprint[0].arn
    NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED = tostring(var.gateway_native_materials.owner_cleanup_enabled)
    NATIVE_APPLICATION_DISPOSAL_ENABLED   = tostring(var.gateway_native_materials.disposal_enabled)
    NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS = jsonencode([for deployment in var.gateway_native_materials.disposal_deployments : {
      clusterArn = deployment.cluster_arn, taskDefinitionArn = deployment.task_definition_arn, containerName = deployment.container_name
    }])
    NATIVE_MATERIAL_AVAILABILITY_ENABLED        = tostring(var.gateway_native_materials.availability_enabled)
    NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED = tostring(var.gateway_native_materials.read_authorizations_enabled)
    NATIVE_MATERIAL_READ_LOCATIONS_ENABLED      = tostring(var.gateway_native_materials.cover_letter_locations_enabled)
    NATIVE_RESUME_READ_LOCATIONS_ENABLED        = tostring(var.gateway_native_materials.resume_locations_enabled)
    NATIVE_COVER_LETTER_PREPARATION_ENABLED     = tostring(var.gateway_native_materials.cover_letter_preparation_enabled)
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
