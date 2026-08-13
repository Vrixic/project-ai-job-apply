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
