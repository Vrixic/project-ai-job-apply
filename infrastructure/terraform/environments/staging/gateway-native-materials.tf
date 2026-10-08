variable "gateway_native_materials" {
  description = "Optional native candidate API configuration. Provisioning grants packet access; all runtime switches default off."
  type = object({
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
