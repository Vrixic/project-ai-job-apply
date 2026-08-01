variable "gateway_image" {
  type    = string
  default = ""
}

variable "worker_image" {
  type    = string
  default = ""
}

variable "migration_image" {
  type    = string
  default = ""
}

variable "gateway_desired_count" {
  type    = number
  default = 1
}

variable "gateway_cpu" {
  type    = number
  default = 256
}

variable "gateway_memory" {
  type    = number
  default = 512
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "worker_cpu" {
  type    = number
  default = 512
}

variable "worker_memory" {
  type    = number
  default = 1024
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

variable "temporal_address" {
  type    = string
  default = ""
}

variable "temporal_namespace" {
  type    = string
  default = ""
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
