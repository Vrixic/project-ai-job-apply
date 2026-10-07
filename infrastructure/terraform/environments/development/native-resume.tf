# Optional original native resume releases. Empty maps preserve the existing environment.
# Retain immutable instances until trusted drain; publish/build/review before populating.

variable "native_resume_source_access_releases" {
  description = "Reviewed immutable source_access releases; empty creates no resources. Stable original-release keys must be retained until drain."
  type = map(object({
    release = object({
      source_sha           = string
      artifact_bucket      = string
      artifacts            = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
      cluster_arn          = string
      task_definition_arn  = string
      database_secret_arn  = string
      platform_kms_key_arn = string
      normalized_bucket    = string
      extension_layer_arn  = string
      subnet_ids           = list(string)
      security_group_ids   = list(string)
    })
    enabled = optional(bool, false)
  }))
  default  = {}
  nullable = false


}
module "native_resume_source_access" {
  depends_on  = [module.platform]
  source      = "../../modules/native-resume-source-access"
  for_each    = var.native_resume_source_access_releases
  account_id  = module.platform.account_id
  environment = "development"
  release     = each.value.release
  enabled     = each.value.enabled
}

variable "native_resume_task_releases" {
  description = "Reviewed immutable task releases; empty creates no resources. Stable original-release keys must be retained until drain."
  type = map(object({
    release = object({
      image_repository             = string
      image_sha256                 = string
      expected_task_definition_arn = string
      owner_function_arn           = string
      source_function_arn          = string
      tls_secret_arn               = string
      tls_secret_version_id        = string
      tls_kms_key_arn              = string
    })
  }))
  default  = {}
  nullable = false
}
module "native_resume_task" {
  source      = "../../modules/native-resume-task"
  for_each    = var.native_resume_task_releases
  account_id  = module.platform.account_id
  environment = "development"
  release     = each.value.release
}

variable "native_resume_preparation_releases" {
  description = "Reviewed immutable preparation releases; empty creates no resources. Stable original-release keys must be retained until drain."
  type = map(object({
    release = object({
      source_sha               = string
      observer_dead_letter_arn = string
      artifact_bucket          = string
      artifacts                = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
      cluster_arn              = string
      task_definition_arn      = string
      database_secret_arn      = string
      platform_kms_key_arn     = string
      image                    = string
      task_subnet_ids          = list(string)
      task_assign_public_ip    = string
      task_security_group_ids  = list(string)
      extension_layer_arn      = string
      subnet_ids               = list(string)
      security_group_ids       = list(string)
    })
    enabled                    = optional(bool, false)
    new_launch_enabled         = optional(bool, false)
    observation_events_enabled = optional(bool, false)
    schedule_enabled           = optional(bool, false)
  }))
  default  = {}
  nullable = false


}
module "native_resume_preparation" {
  depends_on                 = [module.platform]
  source                     = "../../modules/native-resume-preparation"
  for_each                   = var.native_resume_preparation_releases
  account_id                 = module.platform.account_id
  environment                = "development"
  release                    = each.value.release
  enabled                    = each.value.enabled
  new_launch_enabled         = each.value.new_launch_enabled
  observation_events_enabled = each.value.observation_events_enabled
  schedule_enabled           = each.value.schedule_enabled
}

output "native_resume_release_bindings" {
  value = {
    source_access = { for key, release in module.native_resume_source_access : key => {
      functions    = release.qualified_function_arns
      task_binding = release.task_binding
    } }
    tasks = { for key, release in module.native_resume_task : key => {
      task_definition_arn = release.task_definition_arn
      task_role_arn       = release.task_role_arn
      execution_role_arn  = release.execution_role_arn
      image               = release.image
    } }
    preparation = { for key, release in module.native_resume_preparation : key => {
      control_function_arn  = release.control_function_arn
      workflow_function_arn = release.workflow_function_arn
      dispatch_function_arn = release.dispatch_function_arn
      observer_function_arn = release.observer_function_arn
      observer_rule_arn     = release.observer_rule_arn
      launch_configuration  = release.launch_configuration
    } }
  }
}
