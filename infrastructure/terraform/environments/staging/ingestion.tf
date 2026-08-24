variable "deploy_ingestion_runtime" {
  type    = bool
  default = false
}
variable "ingestion_runtime_enabled" {
  type    = bool
  default = false
}
variable "ingestion_synthetic_source_enabled" {
  type    = bool
  default = false
}
variable "ingestion_provider_activation_allowed" {
  type    = bool
  default = false
}
variable "ingestion_provider_sources" {
  type = list(object({
    provider                = string
    source_id               = string
    enabled                 = bool
    tenant                  = string
    region                  = optional(string, "global")
    company_name            = string
    verified_company_domain = string
  }))
  default = []
}
variable "ingestion_durable_artifact_s3_key" {
  type    = string
  default = ""
}
variable "ingestion_durable_artifact_s3_object_version" {
  type    = string
  default = ""
}
variable "ingestion_durable_artifact_sha256" {
  type    = string
  default = ""
}
variable "ingestion_durable_artifact_base64sha256" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_s3_key" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_s3_object_version" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_sha256" {
  type    = string
  default = ""
}
variable "ingestion_runtime_artifact_base64sha256" {
  type    = string
  default = ""
}
variable "ingestion_lambda_extension_layer_arn" {
  type    = string
  default = ""
}
variable "ingestion_synthetic_seed" {
  type    = string
  default = "foundation01"
}
variable "ingestion_execution_timeout_seconds" {
  type    = number
  default = 3600
}
variable "ingestion_retention_days" {
  type    = number
  default = 30
}

output "ingestion_runtime_deployed" { value = module.platform.ingestion_runtime_deployed }
output "ingestion_runtime_enabled" { value = module.platform.ingestion_runtime_enabled }
output "ingestion_synthetic_source_enabled" { value = module.platform.ingestion_synthetic_source_enabled }
output "ingestion_provider_activation_allowed" { value = module.platform.ingestion_provider_activation_allowed }
output "ingestion_provider_source_count" { value = module.platform.ingestion_provider_source_count }
output "ingestion_durable_version_arn" { value = module.platform.ingestion_durable_version_arn }
output "ingestion_dispatch_queue_arn" { value = module.platform.ingestion_dispatch_queue_arn }
output "ingestion_dead_letter_queue_arn" { value = module.platform.ingestion_dead_letter_queue_arn }
