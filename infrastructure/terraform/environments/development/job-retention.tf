variable "job_retention_release" {
  description = "Reviewed immutable Jobs-maintenance artifact; null creates nothing. No secret values."
  type = object({
    source_sha            = string
    artifact_key          = string
    artifact_version      = string
    artifact_sha256       = string
    artifact_base64sha256 = string
    extension_layer_arn   = string
  })
  default = null
  validation {
    condition = var.job_retention_release == null ? !var.job_retention_enabled : (
      can(regex("^[a-f0-9]{40}$", var.job_retention_release.source_sha)) &&
      can(regex("^[a-f0-9]{64}$", var.job_retention_release.artifact_sha256)) &&
      can(regex("^[A-Za-z0-9+/]{43}=$", var.job_retention_release.artifact_base64sha256)) &&
      length(var.job_retention_release.artifact_version) > 0 && var.job_retention_release.artifact_version != "null" &&
      var.job_retention_release.artifact_key == "lambda/jobs/retention/${var.job_retention_release.source_sha}/${var.job_retention_release.artifact_sha256}/job-retention-lambda.zip" &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.job_retention_release.extension_layer_arn))
    )
    error_message = "Use a complete immutable source-bound Jobs artifact and numeric Secrets extension layer; activation requires a release."
  }
}
variable "job_retention_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "job_retention_schedule_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.job_retention_schedule_enabled || var.job_retention_enabled
    error_message = "Scheduling requires the private Jobs runtime gate."
  }
}

output "job_retention_function_arn" {
  value = module.platform.job_retention_function_arn
}
