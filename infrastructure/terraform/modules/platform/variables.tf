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
}

variable "worker_image" {
  type    = string
  default = ""
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

variable "temporal_api_key_secret_arn" {
  type      = string
  default   = ""
  sensitive = true
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
      var.temporal_namespace != "" &&
      var.temporal_api_key_secret_arn != ""
    )
    error_message = "Application deployment requires immutable images, OIDC, and Temporal."
  }
}
