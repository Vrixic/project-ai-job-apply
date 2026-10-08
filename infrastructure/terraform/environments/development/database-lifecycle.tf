variable "development_database_mode" {
  description = "Explicit development database lifecycle. Omitted inputs fail closed to dormant, never silently recreate an empty database."
  type        = string
  default     = "dormant"
  nullable    = false
}

variable "development_database_recovery" {
  description = "Non-secret metadata captured by the database lifecycle operator."
  type = object({
    address                     = string
    port                        = number
    name                        = string
    resource_id                 = string
    final_snapshot_identifier   = string
    restore_snapshot_identifier = optional(string)
  })
  default = null
}

output "development_database_mode" { value = module.platform.development_database_mode }
