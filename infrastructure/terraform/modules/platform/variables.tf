variable "name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "gateway_image" {
  type    = string
  default = ""

  validation {
    condition     = var.gateway_image == "" || can(regex("^.+@sha256:[0-9a-f]{64}$", var.gateway_image))
    error_message = "Gateway image must be empty or an immutable sha256 digest reference."
  }
}

variable "worker_image" {
  type    = string
  default = ""

  validation {
    condition     = var.worker_image == "" || can(regex("^.+@sha256:[0-9a-f]{64}$", var.worker_image))
    error_message = "Worker image must be empty or an immutable sha256 digest reference."
  }
}

variable "migration_image" {
  description = "Scanned gateway-compatible image used only by the controlled database migration task."
  type        = string
  default     = ""

  validation {
    condition     = var.migration_image == "" || can(regex("^.+@sha256:[0-9a-f]{64}$", var.migration_image))
    error_message = "Migration image must be empty or an immutable sha256 digest reference."
  }
}

variable "gateway_desired_count" {
  description = "Gateway tasks to run. Keep at one until measured demand or launch review requires more."
  type        = number
  default     = 1

  validation {
    condition     = var.gateway_desired_count >= 1 && floor(var.gateway_desired_count) == var.gateway_desired_count
    error_message = "Gateway desired count must be a positive integer."
  }
}

variable "gateway_cpu" {
  description = "Fargate CPU units for the gateway task."
  type        = number
  default     = 256
}

variable "gateway_memory" {
  description = "Fargate memory in MiB for the gateway task."
  type        = number
  default     = 512
}

variable "worker_desired_count" {
  description = "Workflow-worker tasks to run. Keep at one until queue evidence requires more."
  type        = number
  default     = 1

  validation {
    condition     = var.worker_desired_count >= 1 && floor(var.worker_desired_count) == var.worker_desired_count
    error_message = "Worker desired count must be a positive integer."
  }
}

variable "worker_cpu" {
  description = "Fargate CPU units for the workflow-worker task."
  type        = number
  default     = 512
}

variable "worker_memory" {
  description = "Fargate memory in MiB for the workflow-worker task."
  type        = number
  default     = 1024
}

variable "enable_tracing" {
  description = "Run one fail-open OpenTelemetry collector sidecar per deployed application task."
  type        = bool
  default     = true
}

variable "otel_collector_image" {
  description = "AWS-supported ADOT collector pinned to an immutable multi-architecture digest."
  type        = string
  default     = "public.ecr.aws/aws-observability/aws-otel-collector@sha256:9b28046359054b414f4ba76056ba4e8cffda2d53fbcee06171d7eeecd71326c3"

  validation {
    condition     = can(regex("^.+@sha256:[0-9a-f]{64}$", var.otel_collector_image))
    error_message = "OpenTelemetry collector image must use an immutable sha256 digest reference."
  }
}

variable "trace_sample_ratio" {
  description = "Root trace sampling ratio; development defaults to complete evidence."
  type        = number
  default     = 1

  validation {
    condition     = var.trace_sample_ratio >= 0 && var.trace_sample_ratio <= 1
    error_message = "Trace sample ratio must be between zero and one."
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

variable "temporal_address" {
  type    = string
  default = ""
}

variable "temporal_namespace" {
  type    = string
  default = ""
}

variable "deploy_applications" {
  description = "Must remain false until identity, images, Temporal, and reviews are ready."
  type        = bool
  default     = false

  validation {
    condition = !var.deploy_applications || (
      var.gateway_image != "" &&
      var.worker_image != "" &&
      var.oidc_issuer != "" &&
      var.temporal_address != "" &&
      var.temporal_namespace != ""
    )
    error_message = "Application deployment requires immutable images, OIDC, and Temporal."
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
  description = "Hard concurrency ceiling protecting the initial PostgreSQL connection budget."
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
