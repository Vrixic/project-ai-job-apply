variable "native_preparation_releases" {
  description = "Original preparation releases; default empty, at most one accepts new outbox work."
  type = map(object({
    release = object({
      source_sha                 = string
      release_id                 = string
      artifact_bucket            = string
      artifacts                  = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
      database_secret_arn        = string
      platform_kms_key_arn       = string
      packet_encryption_key_arn  = string
      packet_fingerprint_key_arn = string
      launcher_function_arn      = string
      queue_arn                  = string
      queue_url                  = string
      queue_kms_key_arn          = string
      dead_letter_arn            = string
      extension_layer_arn        = string
      subnet_ids                 = list(string)
      security_group_ids         = list(string)
    })
    enabled           = optional(bool, false)
    launch_enabled    = optional(bool, false)
    intake_enabled    = optional(bool, false)
    recovery_enabled  = optional(bool, false)
    drain_enabled     = optional(bool, false)
    retained_versions = optional(set(string), [])
  }))
  default  = {}
  nullable = false
  validation {
    condition     = length(var.native_preparation_releases) <= 4 && alltrue([for id, item in var.native_preparation_releases : id == item.release.release_id]) && length([for item in var.native_preparation_releases : item if item.intake_enabled]) <= 1
    error_message = "Preserve original release IDs and enable at most one intake owner."
  }
}
module "native_preparation" {
  depends_on        = [module.platform]
  for_each          = var.native_preparation_releases
  source            = "../../modules/native-application-preparation"
  account_id        = module.platform.account_id
  environment       = "staging"
  release           = each.value.release
  enabled           = each.value.enabled
  launch_enabled    = each.value.launch_enabled
  intake_enabled    = each.value.intake_enabled
  recovery_enabled  = each.value.recovery_enabled
  drain_enabled     = each.value.drain_enabled
  retained_versions = each.value.retained_versions
}
output "native_preparation_bindings" {
  value = { for id, runtime in module.native_preparation : id => {
    functions            = runtime.functions
    durable_function_arn = runtime.durable_function_arn
    role_arns            = runtime.role_arns
    rule_arns            = runtime.rule_arns
  } }
}
