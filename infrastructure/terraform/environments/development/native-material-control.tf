variable "native_material_control_releases" {
  description = "Original cover-letter control releases, default empty. All activation flags default off."
  type = map(object({
    release = object({
      source_sha              = string
      release_id              = string
      artifact_bucket         = string
      artifacts               = map(object({ key = string, version_id = string, sha256 = string, base64sha256 = string }))
      database_secret_arn     = string
      platform_kms_key_arn    = string
      extension_layer_arn     = string
      subnet_ids              = list(string)
      security_group_ids      = list(string)
      cluster_arn             = string
      task_definition_arn     = string
      image_repository        = string
      image_sha256            = string
      task_subnet_ids         = list(string)
      task_security_group_ids = list(string)
    })
    owner_enabled      = optional(bool, false)
    control_enabled    = optional(bool, false)
    recovery_enabled   = optional(bool, false)
    new_launch_enabled = optional(bool, false)
  }))
  default  = {}
  nullable = false
  validation {
    condition     = length(var.native_material_control_releases) <= 4 && alltrue([for id, r in var.native_material_control_releases : id == r.release.release_id])
    error_message = "Retain at most four matching original release IDs."
  }
}
module "native_material_control" {
  depends_on         = [module.platform]
  for_each           = var.native_material_control_releases
  source             = "../../modules/native-material-control"
  account_id         = module.platform.account_id
  environment        = "development"
  release            = each.value.release
  owner_enabled      = each.value.owner_enabled
  control_enabled    = each.value.control_enabled
  recovery_enabled   = each.value.recovery_enabled
  new_launch_enabled = each.value.new_launch_enabled
}
output "native_material_control_bindings" {
  value = { for id, control in module.native_material_control : id => { functions = control.functions, event_rule_arn = control.task_event_rule_arn, dead_letter_arn = control.event_dead_letter_arn, role_arns = control.role_arns, launch_configuration = control.launch_configuration } }
}
