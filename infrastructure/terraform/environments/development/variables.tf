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

variable "database_backup_retention_days" {
  type    = number
  default = 35
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

variable "deploy_public_job_reader" {
  type    = bool
  default = false
}

variable "public_job_database_boundary_version" {
  type    = string
  default = ""

  validation {
    condition     = var.public_job_database_boundary_version == "" || var.public_job_database_boundary_version == "0013_public_job_sitemap"
    error_message = "Public job database boundary must be empty or exactly 0013_public_job_sitemap."
  }
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
  description = "Monotonic document-processing rollout stage."
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
  description = "Operator-derived positive numeric parser version ARN used only by complete-dark."
  type        = string
  default     = ""
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

variable "d2_community_runtime" {
  description = "Complete Phase 2 deploy/activation input passed to the platform module. The default creates and activates nothing."
  type        = any
  default = {
    deploy                                         = false
    enabled                                        = false
    artifact_s3_key                                = ""
    artifact_s3_object_version                     = ""
    artifact_sha256                                = ""
    artifact_base64sha256                          = ""
    lambda_extension_layer_arn                     = ""
    scheduled_reserved_concurrency                 = 0
    signal_reserved_concurrency                    = 0
    lambda_timeout_seconds                         = 0
    queue_visibility_timeout_seconds               = 0
    queue_message_retention_seconds                = 0
    dead_letter_retention_seconds                  = 0
    queue_max_receive_count                        = 0
    schedule_expression                            = ""
    processing_policy_version                      = ""
    processing_worker_id                           = ""
    processing_batch_limit                         = 0
    processing_max_attempts                        = 0
    processing_claim_lease_milliseconds            = 0
    processing_retry_delay_milliseconds            = []
    contribution_delivery_worker_id                = ""
    contribution_delivery_batch_limit              = 0
    contribution_delivery_max_attempts             = 0
    contribution_delivery_claim_lease_milliseconds = 0
    contribution_delivery_retry_delay_milliseconds = []
    trust_delivery_worker_id                       = ""
    trust_delivery_batch_limit                     = 0
    trust_delivery_max_attempts                    = 0
    trust_delivery_claim_lease_milliseconds        = 0
    trust_delivery_retry_delay_milliseconds        = []
    trust_signal_batch_size                        = 0
    provider_activation_allowed                    = false
    provider_private_egress                        = false
    provider_sources_json                          = ""
    provider_verification_registrations_json       = ""
    ugc_contribution_policy_version                = ""
    signed_policy_json                             = ""
    signed_public_keys_json                        = ""
    trust_reviewer_assignments_json                = ""
    trust_evidence_allowlist_json                  = ""
    trust_policy_version                           = ""
    trust_appeal_window_milliseconds               = 0
    trust_system_actor_id                          = ""
    route_throttling_rate_limit                    = 0
    route_throttling_burst_limit                   = 0
    lambda_error_alarm_threshold                   = 0
    lambda_throttle_alarm_threshold                = 0
    lambda_duration_alarm_threshold_milliseconds   = 0
    application_failure_alarm_threshold            = 0
    queue_age_alarm_threshold_seconds              = 0
    dead_letter_alarm_threshold                    = 0
    release_authority                              = ""
  }
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

variable "candidate_rights_enabled" {
  type    = bool
  default = false
}

variable "candidate_rights_auth0_secret_provisioned" {
  type    = bool
  default = false
}

variable "candidate_rights_auth0_authorized_owner" {
  type    = string
  default = ""
}

variable "candidate_rights_id_token_audience" {
  type    = string
  default = ""
}

variable "candidate_rights_policy_version" {
  type    = string
  default = ""
}

variable "candidate_rights_policy_sha256" {
  type    = string
  default = ""
}

variable "candidate_rights_export_lifetime_seconds" {
  type    = number
  default = null
}

variable "candidate_rights_download_grant_seconds" {
  type    = number
  default = null
}

variable "candidate_rights_backup_retention_days" {
  type    = number
  default = null
}

variable "candidate_rights_recent_auth_max_age_seconds" {
  type    = number
  default = null
}

variable "candidate_rights_owner_inventory" {
  type    = string
  default = ""
}

variable "candidate_rights_subprocessor_inventory" {
  type    = string
  default = ""
}

variable "candidate_rights_export_lifecycle_days" {
  type    = number
  default = null
}
