variable "development_database_mode" {
  description = "Data-preserving prelaunch database lifecycle, independent of deployed features: retained, snapshot-prepared, dormant, restore."
  type        = string
  default     = "retained"
  nullable    = false
  validation {
    condition     = contains(["retained", "snapshot-prepared", "dormant", "restore"], var.development_database_mode)
    error_message = "Unknown development database lifecycle mode."
  }
  validation {
    condition = var.development_database_mode == "retained" || (
      var.environment == "development" && var.persistent_data_plane_enabled &&
      !var.serverless_runtime_enabled && !var.ingestion_runtime_enabled &&
      !var.document_scan_mapping_enabled && !var.document_scan_event_rule_enabled &&
      !var.d2_community_runtime.enabled && !var.private_application_networking &&
      !var.ingestion_provider_private_egress && !var.d2_community_runtime.provider_private_egress &&
      !var.privileged_audit_retention_enabled && !var.job_retention_enabled && !var.native_cleanup_enabled &&
      (var.development_database_mode == "restore" || !var.private_service_endpoints_enabled)
    )
    error_message = "Database dormancy requires drained development with runtime, NAT and paid endpoints disabled; restore permits private endpoints but never active application work."
  }
}

variable "development_database_recovery" {
  description = "Exact non-secret connection metadata and snapshot names captured before shutdown. The operator verifies the snapshot and restore before dormancy."
  type = object({
    address                     = string
    port                        = number
    name                        = string
    resource_id                 = string
    final_snapshot_identifier   = string
    restore_snapshot_identifier = optional(string)
  })
  default = null
  validation {
    condition = var.development_database_mode == "retained" || try(
      var.development_database_recovery.address != "" &&
      var.development_database_recovery.port == 5432 &&
      var.development_database_recovery.name == "ai_job_apply" &&
      startswith(var.development_database_recovery.resource_id, "db-") &&
    startswith(var.development_database_recovery.final_snapshot_identifier, "${var.name}-${var.environment}-shutdown-"), false)
    error_message = "Shutdown requires exact retained database metadata and a unique environment-bound final snapshot identifier."
  }
  validation {
    condition = var.development_database_mode != "restore" || try(
    startswith(var.development_database_recovery.restore_snapshot_identifier, "${var.name}-${var.environment}-shutdown-"), false)
    error_message = "Restore must name the exact retained environment snapshot; creating an empty database is forbidden."
  }
}

locals {
  database_provisioned = var.persistent_data_plane_enabled && var.development_database_mode != "dormant"
  # Preserve secrets, IAM and immutable Lambda environment values while no DB instance exists.
  retained_database_address     = local.database_provisioned ? aws_db_instance.postgres[0].address : try(var.development_database_recovery.address, "")
  retained_database_port        = local.database_provisioned ? aws_db_instance.postgres[0].port : try(var.development_database_recovery.port, 5432)
  retained_database_name        = local.database_provisioned ? aws_db_instance.postgres[0].db_name : try(var.development_database_recovery.name, "ai_job_apply")
  retained_database_resource_id = local.database_provisioned ? aws_db_instance.postgres[0].resource_id : try(var.development_database_recovery.resource_id, "")
}

output "development_database_mode" { value = var.development_database_mode }
