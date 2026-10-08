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
}
