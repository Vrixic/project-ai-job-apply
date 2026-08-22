variable "migration_image" {
  type    = string
  default = ""
}

variable "high_availability" {
  type    = bool
  default = false
}

variable "staging_runtime_mode" {
  description = "Lifecycle state for the prelaunch staging data plane: active, quiesced, or dormant. Dormant is the cost-safe default."
  type        = string
  default     = "dormant"

  validation {
    condition     = contains(["active", "quiesced", "dormant"], var.staging_runtime_mode)
    error_message = "Staging runtime mode must be active, quiesced, or dormant."
  }
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
  default = 5
}

variable "deploy_public_job_reader" {
  type    = bool
  default = false
}

variable "public_job_database_boundary_version" {
  type    = string
  default = ""
}

variable "public_job_cluster_residual_accepted" {
  description = "Deprecated compatibility input; the anonymous edge is isolated from the database regardless of this value."
  type        = bool
  default     = false
}

variable "public_job_route_activation_allowed" {
  description = "Explicit release authorization for the isolated anonymous public-job route."
  type        = bool
  default     = false
}

variable "public_job_lambda_artifact_s3_key" {
  type    = string
  default = ""
}

variable "public_job_lambda_artifact_s3_object_version" {
  type    = string
  default = ""
}

variable "public_job_lambda_artifact_sha256" {
  type    = string
  default = ""
}

variable "public_job_lambda_artifact_base64sha256" {
  type    = string
  default = ""
}

variable "public_job_projection_artifact_s3_key" {
  type    = string
  default = ""
}

variable "public_job_projection_artifact_s3_object_version" {
  type    = string
  default = ""
}

variable "public_job_projection_artifact_sha256" {
  type    = string
  default = ""
}

variable "public_job_projection_artifact_base64sha256" {
  type    = string
  default = ""
}

variable "public_job_route_throttling_rate_limit" {
  type    = number
  default = 1
}

variable "public_job_route_throttling_burst_limit" {
  type    = number
  default = 1
}

variable "deploy_document_intake" {
  type    = bool
  default = false
}

variable "candidate_document_cors_allowed_origins" {
  type    = list(string)
  default = []
}

variable "document_processing_deployment_stage" {
  description = "Monotonic document-processing rollout stage; staging remains disabled until a reviewed rollout."
  type        = string
  default     = "disabled"

  validation {
    condition = contains([
      "disabled", "kms-prerequisite", "parser-dark", "complete-dark"
    ], var.document_processing_deployment_stage)
    error_message = "Document processing stage must be disabled, kms-prerequisite, parser-dark, or complete-dark."
  }
}
variable "document_parser_invocation_qualified_arn" {
  type    = string
  default = ""
}
variable "document_scan_mapping_enabled" {
  type    = bool
  default = false
}

variable "document_scan_event_rule_enabled" {
  type    = bool
  default = false
}
variable "document_security_health_rules_enabled" {
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
