variable "migration_image" {
  type    = string
  default = ""
}

variable "high_availability" {
  type    = bool
  default = false
}

variable "private_application_networking" {
  type    = bool
  default = false
}

variable "enable_redis" {
  type    = bool
  default = false
}

variable "database_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "database_engine_version" {
  type    = string
  default = "16.14"
}

variable "database_performance_insights" {
  type    = bool
  default = false
}

variable "enable_container_insights" {
  type    = bool
  default = false
}

variable "oidc_issuer" {
  type      = string
  sensitive = true
  default   = ""
}

variable "oidc_audience" {
  type    = string
  default = "ai-job-apply-api"
}

variable "deploy_applications" {
  type    = bool
  default = false
}

variable "deploy_gateway_lambda" {
  type    = bool
  default = false
}

variable "gateway_lambda_artifact_s3_key" {
  type    = string
  default = ""
}

variable "gateway_lambda_artifact_s3_object_version" {
  type    = string
  default = ""
}

variable "gateway_lambda_artifact_sha256" {
  type    = string
  default = ""
}

variable "gateway_lambda_artifact_base64sha256" {
  type    = string
  default = ""
}

variable "gateway_lambda_extension_layer_arn" {
  type    = string
  default = ""
}

variable "gateway_lambda_reserved_concurrency" {
  type    = number
  default = 2
}

variable "deploy_document_intake" {
  type    = bool
  default = false
}

variable "candidate_document_cors_allowed_origins" {
  type    = list(string)
  default = []
}

variable "deploy_document_processing" {
  type    = bool
  default = false
}
variable "document_processing_kms_prerequisite_enabled" {
  description = "Stage only the exact document EventBridge KMS grants before dark resource creation."
  type        = bool
  default     = false
}
variable "document_scan_mapping_enabled" {
  type    = bool
  default = false
}

variable "document_scan_event_rule_enabled" {
  type    = bool
  default = false
}
variable "document_processor_artifact_s3_key" {
  type    = string
  default = ""
}
variable "document_processor_artifact_s3_object_version" {
  type    = string
  default = ""
}
variable "document_processor_artifact_sha256" {
  type    = string
  default = ""
}
variable "document_processor_artifact_base64sha256" {
  type    = string
  default = ""
}
variable "document_parser_artifact_s3_key" {
  type    = string
  default = ""
}
variable "document_parser_artifact_s3_object_version" {
  type    = string
  default = ""
}
variable "document_parser_artifact_sha256" {
  type    = string
  default = ""
}
variable "document_parser_artifact_base64sha256" {
  type    = string
  default = ""
}
variable "document_processor_extension_layer_arn" {
  type    = string
  default = ""
}
variable "document_parser_version" {
  type    = string
  default = "resume-parser-v1"
}

variable "deploy_serverless_outbox" {
  type    = bool
  default = false
}

variable "workflow_ingress_artifact_s3_key" {
  type    = string
  default = ""
}

variable "workflow_ingress_artifact_s3_object_version" {
  type    = string
  default = ""
}

variable "workflow_ingress_artifact_sha256" {
  type    = string
  default = ""
}

variable "workflow_ingress_artifact_base64sha256" {
  type    = string
  default = ""
}

variable "workflow_ingress_lambda_extension_layer_arn" {
  type    = string
  default = ""
}

variable "serverless_runtime_enabled" {
  type    = bool
  default = false
}

variable "deploy_profile_readiness_durable" {
  type    = bool
  default = false
}

variable "profile_readiness_durable_artifact_s3_key" {
  type    = string
  default = ""
}

variable "profile_readiness_durable_artifact_s3_object_version" {
  type    = string
  default = ""
}

variable "profile_readiness_durable_artifact_sha256" {
  type    = string
  default = ""
}

variable "profile_readiness_durable_artifact_base64sha256" {
  type    = string
  default = ""
}

variable "profile_readiness_activity_artifact_s3_key" {
  type    = string
  default = ""
}

variable "profile_readiness_activity_artifact_s3_object_version" {
  type    = string
  default = ""
}

variable "profile_readiness_activity_artifact_sha256" {
  type    = string
  default = ""
}

variable "profile_readiness_activity_artifact_base64sha256" {
  type    = string
  default = ""
}

variable "profile_readiness_lambda_extension_layer_arn" {
  type    = string
  default = ""
}

variable "profile_readiness_execution_timeout_seconds" {
  type    = number
  default = 3600
}

variable "profile_readiness_retention_days" {
  type    = number
  default = 30
}
