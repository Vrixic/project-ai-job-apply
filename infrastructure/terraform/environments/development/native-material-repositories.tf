variable "native_material_repositories_enabled" {
  description = "Provision the two native image repositories without runtime activation."
  type        = bool
  default     = false
  nullable    = false
}
output "native_material_repositories" {
  value = module.platform.native_material_repositories
}
