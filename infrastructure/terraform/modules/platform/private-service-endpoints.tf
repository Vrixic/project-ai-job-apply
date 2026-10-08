variable "private_service_endpoints_enabled" {
  description = "Retain private AWS interface endpoints. Disable only for drained development shutdown; retained database/storage and endpoint policies remain intact."
  type        = bool
  default     = true
  nullable    = false

  validation {
    condition = var.private_service_endpoints_enabled || (
      var.environment == "development" &&
      !var.serverless_runtime_enabled && !var.ingestion_runtime_enabled &&
      !var.document_scan_mapping_enabled && !var.document_scan_event_rule_enabled &&
      !var.d2_community_runtime.enabled && !var.privileged_audit_retention_enabled &&
      !var.job_retention_enabled && !var.native_cleanup_enabled
    )
    error_message = "Interface endpoints may be removed only during drained development shutdown with public runtime and background workers disabled."
  }
}
