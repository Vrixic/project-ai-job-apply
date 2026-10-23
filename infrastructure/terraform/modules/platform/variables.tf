variable "name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "migration_image" {
  description = "Scanned migration-only image used by the controlled one-off database migration task."
  type        = string
  default     = ""

  validation {
    condition     = var.migration_image == "" || can(regex("^.+@sha256:[0-9a-f]{64}$", var.migration_image))
    error_message = "Migration image must be empty or an immutable sha256 digest reference."
  }
}

variable "high_availability" {
  description = "Enables Multi-AZ data services and per-AZ egress only after a measured need or launch review."
  type        = bool
  default     = false
}

variable "private_application_networking" {
  description = "Runs application tasks in private subnets behind NAT. Lean environments use restricted public-subnet egress."
  type        = bool
  default     = false
}

variable "enable_redis" {
  description = "Provision Redis only after a concrete cache, distributed rate-limit, or lease requirement exists."
  type        = bool
  default     = false
}

variable "database_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "database_engine_version" {
  description = "Explicit RDS PostgreSQL 16 minor version available in the target region."
  type        = string
  default     = "16.14"

  validation {
    condition     = can(regex("^16\\.[0-9]+$", var.database_engine_version))
    error_message = "Database engine version must remain on the reviewed PostgreSQL 16 major version."
  }
}

variable "database_backup_retention_days" {
  description = "RDS automated-backup/PITR retention. Candidate-rights activation must cover its exact deletion backup window."
  type        = number
  default     = 7

  validation {
    condition = (
      floor(var.database_backup_retention_days) == var.database_backup_retention_days &&
      var.database_backup_retention_days >= 1 &&
      var.database_backup_retention_days <= 35
    )
    error_message = "Database backup retention must be a whole number from one through 35 days."
  }
}

variable "database_performance_insights" {
  description = "Enable RDS Performance Insights only on a supported instance class when evidence requires it."
  type        = bool
  default     = false
}

variable "enable_container_insights" {
  description = "Enable enhanced ECS Container Insights after basic logs/metrics prove insufficient."
  type        = bool
  default     = false
}

variable "oidc_issuer" {
  type      = string
  default   = ""
  sensitive = true

  validation {
    condition     = var.oidc_issuer == "" || can(regex("^https://[^[:space:]]+/$", var.oidc_issuer))
    error_message = "OIDC issuer must be an exact HTTPS issuer URL ending with a slash."
  }
}

variable "oidc_audience" {
  type    = string
  default = "ai-job-apply-api"

  validation {
    condition     = length(trimspace(var.oidc_audience)) > 0
    error_message = "OIDC audience must not be empty."
  }
}

variable "deploy_applications" {
  description = "Provision the public API boundary. Keep false during persistent-infrastructure bootstrap."
  type        = bool
  default     = false

  validation {
    condition     = !var.deploy_applications || var.oidc_issuer != ""
    error_message = "Application deployment requires the exact OIDC issuer."
  }
}

variable "deploy_gateway_lambda" {
  description = "Dark-deploy the versioned gateway Lambda without moving API Gateway routes."
  type        = bool
  default     = false

  validation {
    condition = !var.deploy_gateway_lambda || (
      var.deploy_applications &&
      var.oidc_issuer != "" &&
      var.gateway_lambda_artifact_s3_key != "" &&
      var.gateway_lambda_artifact_s3_object_version != "" &&
      var.gateway_lambda_artifact_sha256 != "" &&
      var.gateway_lambda_artifact_base64sha256 != "" &&
      var.gateway_lambda_extension_layer_arn != ""
    )
    error_message = "Dark gateway Lambda deployment requires the existing application/API, exact OIDC, an immutable versioned S3 artifact, its SHA-256, and the reviewed Secrets extension layer."
  }
}

variable "gateway_lambda_artifact_s3_key" {
  description = "Immutable environment artifact-bucket key for the gateway Lambda ZIP."
  type        = string
  default     = ""
}

variable "gateway_lambda_artifact_s3_object_version" {
  description = "Exact S3 object version containing the gateway Lambda ZIP."
  type        = string
  default     = ""
}

variable "gateway_lambda_artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 of the exact gateway Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.gateway_lambda_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.gateway_lambda_artifact_sha256))
    error_message = "Gateway Lambda artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "gateway_lambda_artifact_base64sha256" {
  description = "Base64-encoded SHA-256 of the exact gateway Lambda ZIP for Lambda code integrity."
  type        = string
  default     = ""

  validation {
    condition     = var.gateway_lambda_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.gateway_lambda_artifact_base64sha256))
    error_message = "Gateway Lambda artifact base64 SHA-256 must be empty or one canonical 44-character digest."
  }
}

variable "gateway_lambda_extension_layer_arn" {
  description = "Reviewed us-east-2 AWS Parameters and Secrets Lambda Extension layer ARN."
  type        = string
  default     = ""

  validation {
    condition = var.gateway_lambda_extension_layer_arn == "" || can(regex(
      "^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$",
      var.gateway_lambda_extension_layer_arn
    ))
    error_message = "The extension layer must be an exact versioned AWS Parameters and Secrets layer ARN in us-east-2."
  }
}

variable "gateway_lambda_reserved_concurrency" {
  description = "Hard concurrency ceiling protecting PostgreSQL; each environment selects its accepted workload capacity."
  type        = number
  default     = 2

  validation {
    condition = (
      var.gateway_lambda_reserved_concurrency >= 1 &&
      var.gateway_lambda_reserved_concurrency <= 5 &&
      floor(var.gateway_lambda_reserved_concurrency) == var.gateway_lambda_reserved_concurrency
    )
    error_message = "Gateway Lambda reserved concurrency must be an integer from one through five."
  }
}

variable "deploy_public_job_reader" {
  description = "Provision the dark public-job Lambda; its anonymous route additionally requires every reviewed runtime activation gate."
  type        = bool
  default     = false

  validation {
    condition = !var.deploy_public_job_reader || (
      var.deploy_applications &&
      var.public_job_lambda_artifact_s3_key != "" &&
      var.public_job_lambda_artifact_s3_object_version != "" &&
      var.public_job_lambda_artifact_sha256 != "" &&
      var.public_job_lambda_artifact_base64sha256 != "" &&
      var.public_job_projection_artifact_s3_key != "" &&
      var.public_job_projection_artifact_s3_object_version != "" &&
      var.public_job_projection_artifact_sha256 != "" &&
      var.public_job_projection_artifact_base64sha256 != "" &&
      var.public_job_database_boundary_version == "0013_public_job_sitemap" &&
      var.persistent_data_plane_enabled
    )
    error_message = "Public job reader deployment requires the existing API, persistent database, exact 0013 public-sitemap boundary, and separate immutable versioned edge/projection artifact identities."
  }
}

variable "public_job_database_boundary_version" {
  description = "Exact applied Jobs migration that creates the dedicated public-reader database boundary."
  type        = string
  default     = ""

  validation {
    condition     = var.public_job_database_boundary_version == "" || var.public_job_database_boundary_version == "0013_public_job_sitemap"
    error_message = "Public job database boundary must be empty or exactly 0013_public_job_sitemap."
  }
}

variable "public_job_cluster_residual_accepted" {
  description = "Deprecated compatibility input. The anonymous edge no longer has VPC, database, or RDS-IAM access; this value does not activate the route."
  type        = bool
  default     = false
}

variable "public_job_route_activation_allowed" {
  description = "Explicit release authorization for the anonymous public-job route. False keeps the route structurally absent even when the isolated edge/projection pair is deployed."
  type        = bool
  default     = false
}

variable "public_job_lambda_artifact_s3_key" {
  description = "Versioned artifact-bucket key for the anonymous public-job edge Lambda ZIP."
  type        = string
  default     = ""
}

variable "public_job_lambda_artifact_s3_object_version" {
  description = "Immutable S3 object version for the anonymous public-job edge Lambda ZIP."
  type        = string
  default     = ""
}

variable "public_job_lambda_artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 of the anonymous public-job edge Lambda ZIP."
  type        = string
  default     = ""
  validation {
    condition     = var.public_job_lambda_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.public_job_lambda_artifact_sha256))
    error_message = "Public job Lambda artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "public_job_lambda_artifact_base64sha256" {
  description = "Lambda-compatible base64 SHA-256 of the anonymous public-job edge Lambda ZIP."
  type        = string
  default     = ""
  validation {
    condition     = var.public_job_lambda_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.public_job_lambda_artifact_base64sha256))
    error_message = "Public job Lambda artifact base64 SHA-256 must be empty or canonical."
  }
}

variable "public_job_projection_artifact_s3_key" {
  description = "Versioned artifact-bucket key for the private public-job projection Lambda ZIP."
  type        = string
  default     = ""
}

variable "public_job_projection_artifact_s3_object_version" {
  description = "Immutable S3 object version for the private public-job projection Lambda ZIP."
  type        = string
  default     = ""
}

variable "public_job_projection_artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 of the private public-job projection Lambda ZIP."
  type        = string
  default     = ""
  validation {
    condition     = var.public_job_projection_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.public_job_projection_artifact_sha256))
    error_message = "The public-job projection Lambda artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "public_job_projection_artifact_base64sha256" {
  description = "Lambda-compatible base64 SHA-256 of the private public-job projection Lambda ZIP."
  type        = string
  default     = ""
  validation {
    condition     = var.public_job_projection_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.public_job_projection_artifact_base64sha256))
    error_message = "The public-job projection Lambda base64 SHA-256 must be empty or canonical."
  }
}

variable "public_job_route_throttling_rate_limit" {
  description = "Frozen prelaunch public-job route rate; must match the one-connection Lambda budget."
  type        = number
  default     = 1
  validation {
    condition     = var.public_job_route_throttling_rate_limit == 1
    error_message = "Public job route rate limit is frozen at one request per second."
  }
}

variable "public_job_route_throttling_burst_limit" {
  description = "Frozen prelaunch public-job burst; must match reserved concurrency one."
  type        = number
  default     = 1
  validation {
    condition     = var.public_job_route_throttling_burst_limit == 1
    error_message = "Public job route burst limit is frozen at one request."
  }
}

variable "deploy_document_intake" {
  description = "Provision the private candidate-document quarantine bucket and managed malware scanning boundary."
  type        = bool
  default     = false

  validation {
    condition     = !var.deploy_document_intake || var.deploy_gateway_lambda
    error_message = "Document intake requires the versioned gateway Lambda that issues exact upload grants."
  }
}

variable "candidate_document_cors_allowed_origins" {
  description = "Exact browser origins allowed to use short-lived candidate-document upload grants."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for origin in var.candidate_document_cors_allowed_origins : can(regex(
        "^(https://[^/[:space:]]+|http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?)$",
        origin
      ))
    ])
    error_message = "Document upload CORS origins must be exact HTTPS origins or local HTTP development origins without paths."
  }
}

variable "document_tailoring_invoke_enabled" {
  description = "Lets the Gateway invoke the exact document processor alias for deterministic resume tailoring (ADR-031). It grants nothing unless the Gateway and the complete-dark document runtime are deployed."
  type        = bool
  default     = false
}

variable "document_processing_deployment_stage" {
  description = "Monotonic document-processing rollout stage; every processing trigger remains independently dark."
  type        = string
  default     = "disabled"

  validation {
    condition = contains([
      "disabled", "kms-prerequisite", "parser-dark", "complete-dark"
    ], var.document_processing_deployment_stage)
    error_message = "Document processing stage must be disabled, kms-prerequisite, parser-dark, or complete-dark."
  }

  validation {
    condition = !contains(["parser-dark", "complete-dark"], var.document_processing_deployment_stage) || (
      var.deploy_document_intake &&
      var.document_parser_artifact_s3_key != "" &&
      var.document_parser_artifact_s3_object_version != "" &&
      var.document_parser_artifact_sha256 != "" &&
      var.document_parser_artifact_base64sha256 != ""
    )
    error_message = "Parser-dark and complete-dark require intake and one immutable versioned parser artifact with exact digests."
  }

  validation {
    condition = var.document_processing_deployment_stage != "complete-dark" || (
      var.document_processor_artifact_s3_key != "" &&
      var.document_processor_artifact_s3_object_version != "" &&
      var.document_processor_artifact_sha256 != "" &&
      var.document_processor_artifact_base64sha256 != "" &&
      var.document_processor_extension_layer_arn != ""
    )
    error_message = "Complete-dark requires the immutable processor artifact and reviewed Secrets extension."
  }
}

variable "document_parser_invocation_qualified_arn" {
  description = "Exact already-applied positive numeric parser Lambda version invoked by the coordinator."
  type        = string
  default     = ""

  validation {
    condition = var.document_processing_deployment_stage == "complete-dark" ? can(regex(
      "^arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:function:${var.name}-${var.environment}-document-parser:[1-9][0-9]*$",
      var.document_parser_invocation_qualified_arn
    )) : var.document_parser_invocation_qualified_arn == ""
    error_message = "Only complete-dark accepts a parser invocation ARN, and it must name one positive numeric version of this environment's document-parser Lambda."
  }
}

variable "document_scan_mapping_enabled" {
  description = "Enable the SQS processor mapping after direct dark conformance."
  type        = bool
  default     = false

  validation {
    condition = !var.document_scan_mapping_enabled || (
      var.document_processing_deployment_stage == "complete-dark" && var.serverless_runtime_enabled
    )
    error_message = "Document scan mapping activation requires the deployed processing boundary and active serverless runtime."
  }
}

variable "document_scan_event_rule_enabled" {
  description = "Enable the exact GuardDuty rule only after the queue mapping has passed dark conformance."
  type        = bool
  default     = false

  validation {
    condition = !var.document_scan_event_rule_enabled || (
      var.document_scan_mapping_enabled &&
      var.document_processing_deployment_stage == "complete-dark" &&
      var.serverless_runtime_enabled
    )
    error_message = "The GuardDuty scan rule requires an already-enabled processor mapping and active reviewed runtime."
  }
}

variable "document_security_health_rules_enabled" {
  description = "Enable only the two bounded GuardDuty protection-health alert rules; never enables document processing."
  type        = bool
  default     = false

  validation {
    condition = !var.document_security_health_rules_enabled || (
      var.deploy_document_intake &&
      contains(["parser-dark", "complete-dark"], var.document_processing_deployment_stage)
    )
    error_message = "Document security-health alerts require the deployed candidate-document and parser-dark boundary."
  }
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
  validation {
    condition     = var.document_processor_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.document_processor_artifact_sha256))
    error_message = "Document processor artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "document_processor_artifact_base64sha256" {
  type    = string
  default = ""
  validation {
    condition     = var.document_processor_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.document_processor_artifact_base64sha256))
    error_message = "Document processor artifact base64 SHA-256 must be empty or canonical."
  }
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
  validation {
    condition     = var.document_parser_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.document_parser_artifact_sha256))
    error_message = "Document parser artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "document_parser_artifact_base64sha256" {
  type    = string
  default = ""
  validation {
    condition     = var.document_parser_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.document_parser_artifact_base64sha256))
    error_message = "Document parser artifact base64 SHA-256 must be empty or canonical."
  }
}

variable "document_processor_extension_layer_arn" {
  type    = string
  default = ""
  validation {
    condition = var.document_processor_extension_layer_arn == "" || can(regex(
      "^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$",
      var.document_processor_extension_layer_arn
    ))
    error_message = "The document processor extension must be an exact versioned AWS layer ARN in us-east-2."
  }
}

variable "document_parser_version" {
  type    = string
  default = "resume-parser-v1"
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,64}$", var.document_parser_version))
    error_message = "Document parser version must be a stable one-to-64-character identifier."
  }
}

variable "deploy_serverless_outbox" {
  description = "Dark-deploy the disabled SQS starter and scheduled reconciler without changing normal event routing."
  type        = bool
  default     = false

  validation {
    condition = !var.deploy_serverless_outbox || (
      var.deploy_applications &&
      var.deploy_gateway_lambda &&
      var.workflow_ingress_artifact_s3_key != "" &&
      var.workflow_ingress_artifact_s3_object_version != "" &&
      var.workflow_ingress_artifact_sha256 != "" &&
      var.workflow_ingress_artifact_base64sha256 != "" &&
      var.workflow_ingress_lambda_extension_layer_arn != "" &&
      var.deploy_profile_readiness_durable
    )
    error_message = "Dark serverless outbox deployment requires the existing dark gateway, immutable workflow-ingress artifact, reviewed Secrets extension, and Terraform-managed versioned durable function."
  }
}

variable "serverless_runtime_enabled" {
  description = "Route API traffic to Lambda and enable the SQS/EventBridge durable-workflow triggers."
  type        = bool
  default     = false

  validation {
    condition = !var.serverless_runtime_enabled || (
      var.deploy_applications &&
      var.deploy_gateway_lambda &&
      var.deploy_serverless_outbox &&
      var.deploy_profile_readiness_durable
    )
    error_message = "Serverless runtime activation requires the complete gateway, outbox, and durable-workflow deployment."
  }
}

variable "outbox_starts_paused" {
  description = "Pause only the automatic SQS outbox starter for a reviewed workflow release; preserve queued work, neutral reconciliation, candidate routes, and completion handlers. Disabled mapping readback and in-flight execution drain are separate release prerequisites."
  type        = bool
  default     = false
}

variable "d2_community_runtime" {
  description = "Independent default-off Phase 2 community deployment and activation boundary. Empty values are deliberate: Terraform selects no artifact, authority, timing, policy, route budget, or alarm threshold."
  type = object({
    deploy                                         = bool
    enabled                                        = bool
    maintenance_mode                               = optional(bool, false)
    policy_endpoint_enabled                        = bool
    development_contributions_enabled              = optional(bool, false)
    development_contribution_providers             = optional(list(string), ["greenhouse"])
    development_contribution_domains               = optional(list(string), null)
    artifact_s3_key                                = string
    artifact_s3_object_version                     = string
    artifact_sha256                                = string
    artifact_base64sha256                          = string
    lambda_extension_layer_arn                     = string
    scheduled_reserved_concurrency                 = number
    signal_reserved_concurrency                    = number
    lambda_timeout_seconds                         = number
    queue_visibility_timeout_seconds               = number
    queue_message_retention_seconds                = number
    dead_letter_retention_seconds                  = number
    queue_max_receive_count                        = number
    schedule_expression                            = string
    processing_policy_version                      = string
    processing_worker_id                           = string
    processing_batch_limit                         = number
    processing_max_attempts                        = number
    processing_claim_lease_milliseconds            = number
    processing_retry_delay_milliseconds            = list(number)
    contribution_delivery_worker_id                = string
    contribution_delivery_batch_limit              = number
    contribution_delivery_max_attempts             = number
    contribution_delivery_claim_lease_milliseconds = number
    contribution_delivery_retry_delay_milliseconds = list(number)
    trust_delivery_worker_id                       = string
    trust_delivery_batch_limit                     = number
    trust_delivery_max_attempts                    = number
    trust_delivery_claim_lease_milliseconds        = number
    trust_delivery_retry_delay_milliseconds        = list(number)
    trust_signal_batch_size                        = number
    provider_activation_allowed                    = bool
    provider_private_egress                        = bool
    provider_sources_json                          = string
    provider_verification_registrations_json       = string
    ugc_contribution_policy_version                = string
    signed_policy_json                             = optional(string, "")
    signed_public_keys_json                        = optional(string, "")
    trust_reviewer_assignments_json                = string
    trust_evidence_allowlist_json                  = string
    trust_policy_version                           = string
    trust_appeal_window_milliseconds               = number
    trust_system_actor_id                          = string
    route_throttling_rate_limit                    = number
    route_throttling_burst_limit                   = number
    lambda_error_alarm_threshold                   = number
    lambda_throttle_alarm_threshold                = number
    lambda_duration_alarm_threshold_milliseconds   = number
    application_failure_alarm_threshold            = number
    queue_age_alarm_threshold_seconds              = number
    dead_letter_alarm_threshold                    = number
    release_authority                              = string
  })
  default = {
    deploy                                         = false
    enabled                                        = false
    maintenance_mode                               = false
    policy_endpoint_enabled                        = false
    development_contributions_enabled              = false
    development_contribution_providers             = ["greenhouse"]
    development_contribution_domains               = null
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

  validation {
    condition = !var.d2_community_runtime.deploy || (
      var.persistent_data_plane_enabled &&
      var.d2_community_runtime.artifact_s3_key != "" &&
      var.d2_community_runtime.artifact_s3_object_version != "" &&
      can(regex("^[a-f0-9]{64}$", var.d2_community_runtime.artifact_sha256)) &&
      can(regex("^[A-Za-z0-9+/]{43}=$", var.d2_community_runtime.artifact_base64sha256)) &&
      can(regex("^arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:layer:[A-Za-z0-9_-]+:[1-9][0-9]*$", var.d2_community_runtime.lambda_extension_layer_arn)) &&
      var.d2_community_runtime.scheduled_reserved_concurrency >= 1 &&
      var.d2_community_runtime.scheduled_reserved_concurrency <= 5 &&
      floor(var.d2_community_runtime.scheduled_reserved_concurrency) == var.d2_community_runtime.scheduled_reserved_concurrency &&
      var.d2_community_runtime.signal_reserved_concurrency >= 1 &&
      var.d2_community_runtime.signal_reserved_concurrency <= 5 &&
      floor(var.d2_community_runtime.signal_reserved_concurrency) == var.d2_community_runtime.signal_reserved_concurrency &&
      var.d2_community_runtime.lambda_timeout_seconds >= 1 &&
      var.d2_community_runtime.lambda_timeout_seconds <= 900 &&
      floor(var.d2_community_runtime.lambda_timeout_seconds) == var.d2_community_runtime.lambda_timeout_seconds &&
      var.d2_community_runtime.queue_visibility_timeout_seconds > var.d2_community_runtime.lambda_timeout_seconds &&
      var.d2_community_runtime.queue_visibility_timeout_seconds <= 43200 &&
      var.d2_community_runtime.queue_message_retention_seconds >= 60 &&
      var.d2_community_runtime.queue_message_retention_seconds <= 1209600 &&
      var.d2_community_runtime.dead_letter_retention_seconds >= var.d2_community_runtime.queue_message_retention_seconds &&
      var.d2_community_runtime.dead_letter_retention_seconds <= 1209600 &&
      var.d2_community_runtime.queue_max_receive_count >= 1 &&
      var.d2_community_runtime.queue_max_receive_count <= 10 &&
      floor(var.d2_community_runtime.queue_max_receive_count) == var.d2_community_runtime.queue_max_receive_count &&
      var.d2_community_runtime.lambda_error_alarm_threshold >= 0 &&
      var.d2_community_runtime.lambda_throttle_alarm_threshold >= 0 &&
      var.d2_community_runtime.lambda_duration_alarm_threshold_milliseconds >= 1 &&
      var.d2_community_runtime.lambda_duration_alarm_threshold_milliseconds <= var.d2_community_runtime.lambda_timeout_seconds * 1000 &&
      var.d2_community_runtime.application_failure_alarm_threshold >= 0 &&
      var.d2_community_runtime.application_failure_alarm_threshold <= 1000 &&
      floor(var.d2_community_runtime.application_failure_alarm_threshold) == var.d2_community_runtime.application_failure_alarm_threshold &&
      var.d2_community_runtime.queue_age_alarm_threshold_seconds >= 1 &&
      var.d2_community_runtime.queue_age_alarm_threshold_seconds <= var.d2_community_runtime.queue_message_retention_seconds &&
      var.d2_community_runtime.dead_letter_alarm_threshold >= 0
    )
    error_message = "A Phase 2 dark deployment requires an immutable versioned artifact, reviewed Secrets extension, explicit bounded concurrency/timeout, queue retention/redrive, alarm thresholds, and the persistent data plane."
  }

  validation {
    condition = !var.d2_community_runtime.enabled || (
      var.d2_community_runtime.signal_reserved_concurrency >= 2 &&
      var.d2_community_runtime.signal_reserved_concurrency <= 5 &&
      floor(var.d2_community_runtime.signal_reserved_concurrency) == var.d2_community_runtime.signal_reserved_concurrency
    )
    error_message = "An enabled Phase 2 standard SQS consumer requires integer signal concurrency from 2 through 5, shared by its mapping maximum and Lambda reservation."
  }

  validation {
    condition     = !var.d2_community_runtime.development_contributions_enabled || var.environment == "development"
    error_message = "The unsigned D2 development contribution mode is permitted only in the development environment. Staging and production must retain signed capability policy verification."
  }

  validation {
    condition = (
      length(var.d2_community_runtime.development_contribution_providers) <= 3 &&
      length(distinct(var.d2_community_runtime.development_contribution_providers)) == length(var.d2_community_runtime.development_contribution_providers) &&
      alltrue([for provider in var.d2_community_runtime.development_contribution_providers : try(contains(["greenhouse", "lever", "ashby"], provider), false)]) &&
      (var.d2_community_runtime.development_contribution_providers == tolist(["greenhouse"]) || (
        var.environment == "development" && var.d2_community_runtime.development_contributions_enabled
      ))
    )
    error_message = "Development contribution providers must be an exact list of at most three unique greenhouse, lever, or ashby names. Any choice other than the existing Greenhouse-only default (including empty deny-all) requires explicit development contribution mode."
  }

  validation {
    condition = var.d2_community_runtime.development_contribution_domains == null ? true : (
      var.environment == "development" &&
      var.d2_community_runtime.development_contributions_enabled &&
      length(var.d2_community_runtime.development_contribution_domains) <= 5 &&
      length(distinct(var.d2_community_runtime.development_contribution_domains)) == length(var.d2_community_runtime.development_contribution_domains) &&
      alltrue([for domain in var.d2_community_runtime.development_contribution_domains : try(contains([
        "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.eu.lever.co", "jobs.ashbyhq.com"
      ], domain), false)])
    )
    error_message = "Development contribution domains must be null (no additional restriction) or an exact unique subset of the five supported provider hosts. Any list, including empty deny-all, requires explicit development contribution mode."
  }

  validation {
    condition = !var.d2_community_runtime.policy_endpoint_enabled || (
      var.deploy_applications &&
      var.deploy_gateway_lambda &&
      ((var.d2_community_runtime.enabled && var.d2_community_runtime.development_contributions_enabled) || (
        try(length(keys(jsondecode(var.d2_community_runtime.signed_policy_json))) > 0, false) &&
        try(length(keys(jsondecode(var.d2_community_runtime.signed_public_keys_json))) > 0, false) &&
        length(base64encode(join("", [
          var.d2_community_runtime.signed_policy_json,
          var.d2_community_runtime.signed_public_keys_json
        ]))) <= 1200
      ))
    )
    error_message = "The public Phase 2 policy endpoint requires a deployed Gateway plus a bounded signed policy and pinned public-key map, except in explicitly enabled development contribution mode."
  }

  validation {
    condition = !var.d2_community_runtime.enabled || (
      var.d2_community_runtime.deploy &&
      (var.d2_community_runtime.policy_endpoint_enabled || var.d2_community_runtime.development_contributions_enabled) &&
      var.deploy_applications &&
      var.deploy_gateway_lambda &&
      var.runtime_activation_allowed &&
      can(regex("^(rate|cron)\\([^\r\n]{1,240}\\)$", var.d2_community_runtime.schedule_expression)) &&
      can(regex("^[a-z0-9][a-z0-9._-]{2,99}$", var.d2_community_runtime.processing_policy_version)) &&
      can(regex("^[A-Za-z0-9:_-]{3,100}$", var.d2_community_runtime.processing_worker_id)) &&
      var.d2_community_runtime.processing_batch_limit >= 1 &&
      var.d2_community_runtime.processing_batch_limit <= 100 &&
      floor(var.d2_community_runtime.processing_batch_limit) == var.d2_community_runtime.processing_batch_limit &&
      var.d2_community_runtime.processing_max_attempts >= 1 &&
      var.d2_community_runtime.processing_max_attempts <= 5 &&
      floor(var.d2_community_runtime.processing_max_attempts) == var.d2_community_runtime.processing_max_attempts &&
      var.d2_community_runtime.processing_claim_lease_milliseconds >= 1000 &&
      var.d2_community_runtime.processing_claim_lease_milliseconds <= 900000 &&
      floor(var.d2_community_runtime.processing_claim_lease_milliseconds) == var.d2_community_runtime.processing_claim_lease_milliseconds &&
      length(var.d2_community_runtime.processing_retry_delay_milliseconds) == var.d2_community_runtime.processing_max_attempts - 1 &&
      alltrue([for value in var.d2_community_runtime.processing_retry_delay_milliseconds : value >= 1000 && value <= 86400000]) &&
      can(regex("^[A-Za-z0-9:_-]{3,100}$", var.d2_community_runtime.contribution_delivery_worker_id)) &&
      var.d2_community_runtime.contribution_delivery_batch_limit >= 1 &&
      var.d2_community_runtime.contribution_delivery_batch_limit <= 100 &&
      floor(var.d2_community_runtime.contribution_delivery_batch_limit) == var.d2_community_runtime.contribution_delivery_batch_limit &&
      var.d2_community_runtime.contribution_delivery_max_attempts >= 1 &&
      var.d2_community_runtime.contribution_delivery_max_attempts <= 5 &&
      floor(var.d2_community_runtime.contribution_delivery_max_attempts) == var.d2_community_runtime.contribution_delivery_max_attempts &&
      var.d2_community_runtime.contribution_delivery_claim_lease_milliseconds >= 1000 &&
      var.d2_community_runtime.contribution_delivery_claim_lease_milliseconds <= 900000 &&
      floor(var.d2_community_runtime.contribution_delivery_claim_lease_milliseconds) == var.d2_community_runtime.contribution_delivery_claim_lease_milliseconds &&
      length(var.d2_community_runtime.contribution_delivery_retry_delay_milliseconds) == var.d2_community_runtime.contribution_delivery_max_attempts - 1 &&
      alltrue([for value in var.d2_community_runtime.contribution_delivery_retry_delay_milliseconds : value >= 1000 && value <= 86400000]) &&
      can(regex("^[A-Za-z0-9:_-]{3,100}$", var.d2_community_runtime.trust_delivery_worker_id)) &&
      var.d2_community_runtime.trust_delivery_batch_limit >= 1 &&
      var.d2_community_runtime.trust_delivery_batch_limit <= 100 &&
      floor(var.d2_community_runtime.trust_delivery_batch_limit) == var.d2_community_runtime.trust_delivery_batch_limit &&
      var.d2_community_runtime.trust_delivery_max_attempts >= 1 &&
      var.d2_community_runtime.trust_delivery_max_attempts <= 5 &&
      floor(var.d2_community_runtime.trust_delivery_max_attempts) == var.d2_community_runtime.trust_delivery_max_attempts &&
      var.d2_community_runtime.trust_delivery_claim_lease_milliseconds >= 1000 &&
      var.d2_community_runtime.trust_delivery_claim_lease_milliseconds <= 900000 &&
      floor(var.d2_community_runtime.trust_delivery_claim_lease_milliseconds) == var.d2_community_runtime.trust_delivery_claim_lease_milliseconds &&
      length(var.d2_community_runtime.trust_delivery_retry_delay_milliseconds) == var.d2_community_runtime.trust_delivery_max_attempts - 1 &&
      alltrue([for value in var.d2_community_runtime.trust_delivery_retry_delay_milliseconds : value >= 1000 && value <= 86400000]) &&
      var.d2_community_runtime.trust_signal_batch_size >= 1 &&
      var.d2_community_runtime.trust_signal_batch_size <= 10 &&
      floor(var.d2_community_runtime.trust_signal_batch_size) == var.d2_community_runtime.trust_signal_batch_size &&
      var.d2_community_runtime.provider_activation_allowed &&
      var.d2_community_runtime.provider_private_egress &&
      try(length(tolist(jsondecode(var.d2_community_runtime.provider_sources_json))) > 0, false) &&
      try(length(tolist(jsondecode(var.d2_community_runtime.provider_verification_registrations_json))) > 0, false) &&
      can(regex("^[a-z0-9][a-z0-9._-]{2,99}$", var.d2_community_runtime.ugc_contribution_policy_version)) &&
      (var.d2_community_runtime.development_contributions_enabled || (
        try(length(keys(jsondecode(var.d2_community_runtime.signed_policy_json))) > 0, false) &&
        try(length(keys(jsondecode(var.d2_community_runtime.signed_public_keys_json))) > 0, false)
      )) &&
      try(length(tolist(jsondecode(var.d2_community_runtime.trust_reviewer_assignments_json))) > 0, false) &&
      try(length(tolist(jsondecode(var.d2_community_runtime.trust_evidence_allowlist_json))) >= 0, false) &&
      length(base64encode(join("", [
        var.d2_community_runtime.development_contributions_enabled ? "" : var.d2_community_runtime.signed_policy_json,
        var.d2_community_runtime.development_contributions_enabled ? "" : var.d2_community_runtime.signed_public_keys_json,
        var.d2_community_runtime.development_contributions_enabled && var.d2_community_runtime.development_contribution_providers != tolist(["greenhouse"]) ? jsonencode(var.d2_community_runtime.development_contribution_providers) : "",
        var.d2_community_runtime.development_contributions_enabled && var.d2_community_runtime.development_contribution_domains != null ? jsonencode(var.d2_community_runtime.development_contribution_domains) : "",
        var.d2_community_runtime.trust_reviewer_assignments_json,
        var.d2_community_runtime.trust_evidence_allowlist_json,
        var.d2_community_runtime.provider_sources_json,
        var.d2_community_runtime.provider_verification_registrations_json
      ]))) <= (var.environment == "development" && var.d2_community_runtime.development_contributions_enabled ? 3000 : 2400) &&
      can(regex("^[a-z0-9][a-z0-9._-]{2,99}$", var.d2_community_runtime.trust_policy_version)) &&
      var.d2_community_runtime.trust_appeal_window_milliseconds >= 1 &&
      var.d2_community_runtime.trust_appeal_window_milliseconds <= 31536000000 &&
      floor(var.d2_community_runtime.trust_appeal_window_milliseconds) == var.d2_community_runtime.trust_appeal_window_milliseconds &&
      can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", var.d2_community_runtime.trust_system_actor_id)) &&
      var.d2_community_runtime.route_throttling_rate_limit > 0 &&
      var.d2_community_runtime.route_throttling_rate_limit <= 10000 &&
      var.d2_community_runtime.route_throttling_burst_limit >= 1 &&
      var.d2_community_runtime.route_throttling_burst_limit <= 5000 &&
      floor(var.d2_community_runtime.route_throttling_burst_limit) == var.d2_community_runtime.route_throttling_burst_limit &&
      can(regex("^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,255}$", var.d2_community_runtime.release_authority))
    )
    error_message = "Phase 2 activation requires the dark deployment, application gateway, explicit schedule, processing/delivery lease-retry-batch policies, non-empty explicitly authorized provider sources and independent-verification registrations, signed contribution policy unless development contribution mode is explicitly enabled, complete Trust policy/authority, route budgets, runtime activation authority, and accountable release authority."
  }

  validation {
    condition = !var.d2_community_runtime.provider_private_egress || (
      var.d2_community_runtime.enabled &&
      var.d2_community_runtime.provider_activation_allowed &&
      try(length(tolist(jsondecode(var.d2_community_runtime.provider_sources_json))) > 0, false) &&
      try(length(tolist(jsondecode(var.d2_community_runtime.provider_verification_registrations_json))) > 0, false)
    )
    error_message = "D2 provider-only private egress cannot exist without an enabled runtime, explicit provider authority, and non-empty source and verification registries."
  }
}

variable "persistent_data_plane_enabled" {
  description = "Provision the persistent database and private AWS service endpoints required by an active runtime. Disable only after the serverless runtime is quiesced."
  type        = bool
  default     = true
}

variable "database_deletion_protection" {
  description = "Protect the active PostgreSQL instance from deletion. A reviewed quiesce apply must set this false before an on-demand environment is deactivated."
  type        = bool
  default     = true
}

variable "retain_database_snapshot_on_destroy" {
  description = "Create a final RDS snapshot when the disposable data plane is destroyed. Prelaunch staging uses synthetic data and may explicitly disable this."
  type        = bool
  default     = true
}

variable "runtime_activation_allowed" {
  description = "Environment-level gate for public routes and workflow triggers. On-demand callers use this to restrict activation to their explicit active lifecycle state."
  type        = bool
  default     = true
}

variable "workflow_ingress_artifact_s3_key" {
  description = "Immutable environment artifact-bucket key for the starter/reconciler Lambda ZIP."
  type        = string
  default     = ""
}

variable "workflow_ingress_artifact_s3_object_version" {
  description = "Exact S3 object version containing the starter/reconciler Lambda ZIP."
  type        = string
  default     = ""
}

variable "workflow_ingress_artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 of the exact workflow-ingress Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.workflow_ingress_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.workflow_ingress_artifact_sha256))
    error_message = "Workflow-ingress artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "workflow_ingress_artifact_base64sha256" {
  description = "Base64-encoded SHA-256 of the exact workflow-ingress Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.workflow_ingress_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.workflow_ingress_artifact_base64sha256))
    error_message = "Workflow-ingress artifact base64 SHA-256 must be empty or one canonical 44-character digest."
  }
}

variable "workflow_ingress_lambda_extension_layer_arn" {
  description = "Reviewed us-east-2 AWS Parameters and Secrets Lambda Extension layer ARN."
  type        = string
  default     = ""

  validation {
    condition = var.workflow_ingress_lambda_extension_layer_arn == "" || can(regex(
      "^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$",
      var.workflow_ingress_lambda_extension_layer_arn
    ))
    error_message = "The workflow-ingress extension layer must be an exact versioned AWS Parameters and Secrets layer ARN in us-east-2."
  }
}

variable "deploy_profile_readiness_durable" {
  description = "Dark-deploy the CMK-encrypted profile-readiness durable function and private activity/terminal Lambdas."
  type        = bool
  default     = false

  validation {
    condition = !var.deploy_profile_readiness_durable || (
      var.deploy_applications &&
      var.profile_readiness_durable_artifact_s3_key != "" &&
      var.profile_readiness_durable_artifact_s3_object_version != "" &&
      var.profile_readiness_durable_artifact_sha256 != "" &&
      var.profile_readiness_durable_artifact_base64sha256 != "" &&
      var.profile_readiness_activity_artifact_s3_key != "" &&
      var.profile_readiness_activity_artifact_s3_object_version != "" &&
      var.profile_readiness_activity_artifact_sha256 != "" &&
      var.profile_readiness_activity_artifact_base64sha256 != "" &&
      var.profile_readiness_lambda_extension_layer_arn != ""
    )
    error_message = "Dark profile-readiness deployment requires the existing application database, both immutable artifacts with exact S3 versions/digests, and the reviewed Secrets extension."
  }
}

variable "profile_readiness_durable_artifact_s3_key" {
  description = "Immutable environment artifact-bucket key for the profile-readiness durable Lambda ZIP."
  type        = string
  default     = ""
}

variable "profile_readiness_durable_artifact_s3_object_version" {
  description = "Exact S3 object version containing the profile-readiness durable Lambda ZIP."
  type        = string
  default     = ""
}

variable "profile_readiness_durable_artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 of the exact profile-readiness durable Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.profile_readiness_durable_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.profile_readiness_durable_artifact_sha256))
    error_message = "Profile-readiness durable artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "profile_readiness_durable_artifact_base64sha256" {
  description = "Base64-encoded SHA-256 of the exact profile-readiness durable Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.profile_readiness_durable_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.profile_readiness_durable_artifact_base64sha256))
    error_message = "Profile-readiness durable artifact base64 SHA-256 must be empty or one canonical 44-character digest."
  }
}

variable "profile_readiness_activity_artifact_s3_key" {
  description = "Immutable environment artifact-bucket key for the profile-readiness activity/terminal Lambda ZIP."
  type        = string
  default     = ""
}

variable "profile_readiness_activity_artifact_s3_object_version" {
  description = "Exact S3 object version containing the profile-readiness activity/terminal Lambda ZIP."
  type        = string
  default     = ""
}

variable "profile_readiness_activity_artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 of the exact profile-readiness activity/terminal Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.profile_readiness_activity_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.profile_readiness_activity_artifact_sha256))
    error_message = "Profile-readiness activity artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "profile_readiness_activity_artifact_base64sha256" {
  description = "Base64-encoded SHA-256 of the exact profile-readiness activity/terminal Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.profile_readiness_activity_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.profile_readiness_activity_artifact_base64sha256))
    error_message = "Profile-readiness activity artifact base64 SHA-256 must be empty or one canonical 44-character digest."
  }
}

variable "profile_readiness_lambda_extension_layer_arn" {
  description = "Reviewed us-east-2 AWS Parameters and Secrets Lambda Extension layer ARN for private database handlers."
  type        = string
  default     = ""

  validation {
    condition = var.profile_readiness_lambda_extension_layer_arn == "" || can(regex(
      "^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[0-9]+$",
      var.profile_readiness_lambda_extension_layer_arn
    ))
    error_message = "The profile-readiness extension layer must be an exact versioned AWS Parameters and Secrets layer ARN in us-east-2."
  }
}

variable "profile_readiness_execution_timeout_seconds" {
  description = "Whole durable-execution timeout; deliberately separate from each Lambda invocation timeout."
  type        = number
  default     = 3600

  validation {
    condition     = var.profile_readiness_execution_timeout_seconds >= 60 && var.profile_readiness_execution_timeout_seconds <= 86400 && floor(var.profile_readiness_execution_timeout_seconds) == var.profile_readiness_execution_timeout_seconds
    error_message = "Profile-readiness durable timeout must be a whole number from 60 through 86400 seconds."
  }
}

variable "profile_readiness_retention_days" {
  description = "Bounded operational execution-history retention; PostgreSQL remains product and audit truth."
  type        = number
  default     = 30

  validation {
    condition     = var.profile_readiness_retention_days >= 1 && var.profile_readiness_retention_days <= 30 && floor(var.profile_readiness_retention_days) == var.profile_readiness_retention_days
    error_message = "Profile-readiness history retention must be a whole number from one through 30 days."
  }
}

variable "candidate_rights_enabled" {
  description = "Provision candidate data-export/account-deletion resources after policy review; retain them while serverless_runtime_enabled is false."
  type        = bool
  default     = false

  validation {
    condition = !var.candidate_rights_enabled || (
      var.deploy_gateway_lambda &&
      var.deploy_document_intake &&
      var.deploy_serverless_outbox &&
      var.deploy_profile_readiness_durable &&
      (!var.serverless_runtime_enabled || var.private_application_networking) &&
      var.candidate_rights_auth0_secret_provisioned &&
      var.candidate_rights_id_token_audience != "" &&
      var.candidate_rights_policy_version != "" &&
      can(regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", var.candidate_rights_policy_version)) &&
      can(regex("^[a-f0-9]{64}$", var.candidate_rights_policy_sha256)) &&
      contains([
        "identity,profile,documents,jobs,matching,billing,trust",
        "identity,profile,documents,jobs,matching,billing,trust,applications",
        "identity,profile,documents,jobs,matching,billing,trust,applications,notifications",
      ], var.candidate_rights_owner_inventory) &&
      var.candidate_rights_subprocessor_inventory != "" &&
      var.candidate_rights_export_lifetime_seconds != null &&
      var.candidate_rights_download_grant_seconds != null &&
      var.candidate_rights_backup_retention_days != null &&
      try(var.database_backup_retention_days >= var.candidate_rights_backup_retention_days, false) &&
      var.candidate_rights_recent_auth_max_age_seconds != null &&
      var.candidate_rights_export_lifecycle_days != null
    )
    error_message = "Candidate rights require deployed gateway/document/outbox/durable resources, private NAT egress when the runtime is active, an exact accountable policy inventory, and explicit timing/lifecycle values. Retain storage while quiesced."
  }
}

variable "candidate_rights_auth0_secret_provisioned" {
  description = "Provision the operator-populated Auth0 Management API secret before candidate-rights runtime activation."
  type        = bool
  default     = false

  validation {
    condition = !var.candidate_rights_auth0_secret_provisioned || (
      var.candidate_rights_auth0_authorized_owner != "" &&
      can(regex("^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$", var.candidate_rights_auth0_authorized_owner)) &&
      !can(regex("zach[^a-z0-9]*becker", lower(var.candidate_rights_auth0_authorized_owner)))
    )
    error_message = "Candidate-rights Auth0 secret provisioning requires one explicit safe non-Zach authorized owner identifier."
  }
}

variable "candidate_rights_auth0_authorized_owner" {
  description = "Non-secret accountable owner identifier applied as a managed tag to the generated-synthetic Auth0 secret."
  type        = string
  default     = ""
}

variable "candidate_rights_id_token_audience" {
  description = "Exact non-secret Auth0 web client audience accepted only for recent-MFA candidate-rights ID-token proof."
  type        = string
  default     = ""

  validation {
    condition     = var.candidate_rights_id_token_audience == "" || can(regex("^[A-Za-z0-9_-]{16,256}$", var.candidate_rights_id_token_audience))
    error_message = "Candidate-rights ID-token audience must be empty while disabled or exactly 16 through 256 URL-safe client-ID characters."
  }
}

variable "candidate_rights_policy_version" {
  type    = string
  default = ""
}

variable "candidate_rights_policy_sha256" {
  type    = string
  default = ""

  validation {
    condition     = var.candidate_rights_policy_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.candidate_rights_policy_sha256))
    error_message = "Candidate-rights policy SHA-256 must be empty or exactly 64 lowercase hexadecimal characters."
  }
}

variable "candidate_rights_export_lifetime_seconds" {
  type    = number
  default = null

  validation {
    condition = var.candidate_rights_export_lifetime_seconds == null || try(
      floor(var.candidate_rights_export_lifetime_seconds) == var.candidate_rights_export_lifetime_seconds &&
      var.candidate_rights_export_lifetime_seconds >= 300 &&
      var.candidate_rights_export_lifetime_seconds <= 604800,
      false
    )
    error_message = "Candidate export lifetime must be a whole number from 300 through 604800 seconds."
  }
}

variable "candidate_rights_download_grant_seconds" {
  type    = number
  default = null

  validation {
    condition = var.candidate_rights_download_grant_seconds == null || try(
      floor(var.candidate_rights_download_grant_seconds) == var.candidate_rights_download_grant_seconds &&
      var.candidate_rights_download_grant_seconds >= 60 &&
      var.candidate_rights_download_grant_seconds <= 900,
      false
    )
    error_message = "Candidate export download grants must last 60 through 900 whole seconds."
  }
}

variable "candidate_rights_backup_retention_days" {
  type    = number
  default = null

  validation {
    condition = var.candidate_rights_backup_retention_days == null || try(
      floor(var.candidate_rights_backup_retention_days) == var.candidate_rights_backup_retention_days &&
      var.candidate_rights_backup_retention_days >= 1 &&
      var.candidate_rights_backup_retention_days <= 35,
      false
    )
    error_message = "Candidate deletion backup retention must be a whole number from one through 35 days."
  }
}

variable "candidate_rights_recent_auth_max_age_seconds" {
  type    = number
  default = null

  validation {
    condition = var.candidate_rights_recent_auth_max_age_seconds == null || try(
      floor(var.candidate_rights_recent_auth_max_age_seconds) == var.candidate_rights_recent_auth_max_age_seconds &&
      var.candidate_rights_recent_auth_max_age_seconds >= 60 &&
      var.candidate_rights_recent_auth_max_age_seconds <= 900,
      false
    )
    error_message = "Candidate-rights recent authentication age must be a whole number from 60 through 900 seconds."
  }
}

variable "candidate_rights_owner_inventory" {
  type    = string
  default = ""
}

variable "candidate_rights_subprocessor_inventory" {
  description = "Exact comma-separated adapter IDs, or the literal none after accountable review."
  type        = string
  default     = ""

  validation {
    condition = var.candidate_rights_subprocessor_inventory == "" || var.candidate_rights_subprocessor_inventory == "none" || can(regex(
      "^[a-z][a-z0-9_-]{0,63}(,[a-z][a-z0-9_-]{0,63})*$",
      var.candidate_rights_subprocessor_inventory
    ))
    error_message = "Candidate-rights subprocessors must be explicit lowercase adapter IDs or the literal none."
  }
}

variable "candidate_rights_export_lifecycle_days" {
  description = "Defense-in-depth S3 lifecycle expiry; application grants still stop at the exact seconds-based policy deadline."
  type        = number
  default     = null

  validation {
    condition = var.candidate_rights_export_lifecycle_days == null || var.candidate_rights_export_lifetime_seconds == null || try(
      floor(var.candidate_rights_export_lifecycle_days) == var.candidate_rights_export_lifecycle_days &&
      var.candidate_rights_export_lifecycle_days >= 1 &&
      var.candidate_rights_export_lifecycle_days <= 8 &&
      var.candidate_rights_export_lifecycle_days >= ceil(var.candidate_rights_export_lifetime_seconds / 86400),
      false
    )
    error_message = "Candidate export lifecycle must be one through eight whole days and cannot precede the seconds-based export deadline."
  }
}

variable "restricted_answer_vault_enabled" {
  description = "Provision the dedicated KMS key for the restricted-answer vault (ADR-010, D3-001) and grant the gateway Lambda role Encrypt/Decrypt on it. Never the shared platform key: that key also encrypts the database itself."
  type        = bool
  default     = false

  validation {
    condition     = !var.restricted_answer_vault_enabled || var.deploy_gateway_lambda
    error_message = "The restricted-answer vault key requires the gateway Lambda for the candidate's save/delete boundary."
  }
}

variable "restricted_answer_reuse_enabled" {
  description = "Enable explicit exact-version saved-answer selection in Applications after a reviewed release; never infer or silently reuse values."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition = !var.restricted_answer_reuse_enabled || (
      var.deploy_applications && var.deploy_gateway_lambda &&
      var.restricted_answer_vault_enabled && var.restricted_packet_keys_provisioned &&
      try(var.gateway_native_materials.packet_protection_enabled, false)
    )
    error_message = "Saved-answer reuse requires Applications, the Gateway, the dedicated vault key and enabled packet protection with separate keys."
  }
}

variable "restricted_answer_export_enabled" {
  description = "Allow the private candidate-rights activity to decrypt latest non-deleted restricted answers into the candidate's encrypted export only."
  type        = bool
  default     = false

  validation {
    condition     = !var.restricted_answer_export_enabled || (var.restricted_answer_vault_enabled && var.candidate_rights_enabled && var.deploy_profile_readiness_durable)
    error_message = "Restricted-answer export requires the dedicated vault key and active candidate-rights durable runtime."
  }
}

variable "applications_attempt_recovery_enabled" {
  description = "Dark-deploy the scheduled Lambda that resolves a submission attempt whose worker vanished (D3-005/D3-008/D3-011)."
  type        = bool
  default     = false

  validation {
    condition = !var.applications_attempt_recovery_enabled || (
      var.deploy_gateway_lambda &&
      var.applications_attempt_recovery_artifact_s3_key != "" &&
      var.applications_attempt_recovery_artifact_s3_object_version != "" &&
      var.applications_attempt_recovery_artifact_sha256 != "" &&
      var.applications_attempt_recovery_artifact_base64sha256 != "" &&
      var.profile_readiness_lambda_extension_layer_arn != ""
    )
    error_message = "The applications attempt-recovery scheduler requires the existing application database, an immutable artifact with its exact S3 version/digests, and the reviewed Secrets extension."
  }
}

variable "applications_attempt_recovery_artifact_s3_key" {
  description = "Immutable environment artifact-bucket key for the applications attempt-recovery Lambda ZIP."
  type        = string
  default     = ""
}

variable "applications_attempt_recovery_artifact_s3_object_version" {
  description = "Exact S3 object version containing the applications attempt-recovery Lambda ZIP."
  type        = string
  default     = ""
}

variable "applications_attempt_recovery_artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 of the exact applications attempt-recovery Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.applications_attempt_recovery_artifact_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.applications_attempt_recovery_artifact_sha256))
    error_message = "Applications attempt-recovery artifact SHA-256 must be empty or 64 lowercase hexadecimal characters."
  }
}

variable "applications_attempt_recovery_artifact_base64sha256" {
  description = "Base64-encoded SHA-256 of the exact applications attempt-recovery Lambda ZIP."
  type        = string
  default     = ""

  validation {
    condition     = var.applications_attempt_recovery_artifact_base64sha256 == "" || can(regex("^[A-Za-z0-9+/]{43}=$", var.applications_attempt_recovery_artifact_base64sha256))
    error_message = "Applications attempt-recovery artifact base64 SHA-256 must be empty or one canonical 44-character digest."
  }
}
