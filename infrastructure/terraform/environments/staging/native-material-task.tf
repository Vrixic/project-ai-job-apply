variable "native_material_task_releases" {
  description = "Retained original cover-letter task releases, empty by default. Registration does not launch tasks."
  type = map(object({
    image_repository             = string
    image_sha256                 = string
    expected_task_definition_arn = string
    owner_function_arn           = string
    tls_secret_arn               = string
    tls_secret_version_id        = string
    tls_kms_key_arn              = string
  }))
  default  = {}
  nullable = false
  validation {
    condition     = length(var.native_material_task_releases) <= 4 && alltrue([for id, release in var.native_material_task_releases : id == "r${element(reverse(split(":", release.expected_task_definition_arn)), 0)}"])
    error_message = "Retain at most four original task revisions keyed by r plus numeric revision."
  }
}
module "native_material_task" {
  for_each    = var.native_material_task_releases
  source      = "../../modules/native-material-task"
  account_id  = module.platform.account_id
  environment = "staging"
  release     = each.value
}
output "native_material_task_bindings" {
  value = { for id, task in module.native_material_task : id => {
    task_definition_arn = task.task_definition_arn
    task_role_arn       = task.task_role_arn
    execution_role_arn  = task.execution_role_arn
    image               = task.image
  } }
}
