variable "development_database_mode" {
  description = "Explicit development database lifecycle. Omitted inputs fail closed to dormant, never silently recreate an empty database."
  type        = string
  default     = "dormant"
  nullable    = false
  validation {
    condition = (var.development_database_mode == "retained" && var.private_service_endpoints_enabled) || (
      alltrue([for r in values(var.native_resume_source_access_releases) : !r.enabled]) &&
      alltrue([for r in values(var.native_preparation_releases) : !(r.enabled || r.launch_enabled || r.intake_enabled || r.recovery_enabled || r.drain_enabled || r.route_enabled || r.route_creation_enabled)]) &&
      alltrue([for r in values(var.native_material_control_releases) : !(r.owner_enabled || r.control_enabled || r.recovery_enabled || r.new_launch_enabled || r.route_enabled)]) &&
      alltrue([for r in values(var.native_resume_preparation_releases) : !(r.enabled || r.new_launch_enabled || r.observation_events_enabled || r.observation_schedule_enabled || r.schedule_enabled || r.route_enabled || r.route_creation_enabled || r.terminal_events_enabled || r.execution_inspection_enabled || r.execution_reconciliation_enabled)]) &&
      (var.gateway_native_materials == null ? true : !(var.gateway_native_materials.owner_cleanup_enabled || var.gateway_native_materials.disposal_enabled || var.gateway_native_materials.resume_preparation_enabled || var.gateway_native_materials.cover_letter_preparation_enabled))
    )
    error_message = "Database shutdown, restore and interface-endpoint removal require native source, launch, intake, routing, observation and recovery activity disabled; retain original release maps and drain before shutdown."
  }
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
