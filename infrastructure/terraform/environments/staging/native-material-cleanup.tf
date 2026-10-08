variable "native_cleanup_release" {
  description = "Reviewed immutable native-cleanup artifact; null creates nothing. No secret values."
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
    condition = var.native_cleanup_release == null ? !var.native_cleanup_enabled : (
      can(regex("^[a-f0-9]{40}$", var.native_cleanup_release.source_sha)) &&
      can(regex("^[a-f0-9]{64}$", var.native_cleanup_release.artifact_sha256)) &&
      can(regex("^[A-Za-z0-9+/]{43}=$", var.native_cleanup_release.artifact_base64sha256)) &&
      length(var.native_cleanup_release.artifact_version) > 0 && var.native_cleanup_release.artifact_version != "null" &&
      var.native_cleanup_release.artifact_key == "lambda/native-material/cleanup/${var.native_cleanup_release.source_sha}/${var.native_cleanup_release.artifact_sha256}/native-material-cleanup-worker-lambda.zip" &&
      can(regex("^arn:aws:lambda:us-east-2:[0-9]{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension:[1-9][0-9]*$", var.native_cleanup_release.extension_layer_arn))
    )
    error_message = "Use a complete immutable source-bound native cleanup artifact and numeric Secrets extension layer; activation requires a release."
  }
}
variable "native_cleanup_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "native_cleanup_schedule_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.native_cleanup_schedule_enabled || var.native_cleanup_enabled
    error_message = "Scheduling requires the private native cleanup runtime gate."
  }
}

variable "native_cleanup_deployments" {
  type     = list(object({ cluster_arn = string, task_definition_arn = string, container_name = string }))
  default  = []
  nullable = false
}
output "native_cleanup_function_arn" { value = module.platform.native_cleanup_function_arn }
