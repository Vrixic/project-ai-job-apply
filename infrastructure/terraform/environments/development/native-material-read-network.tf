variable "native_material_read_networks" {
  description = "Optional native task network provisioning; empty by default and does not activate launches or DNS."
  type        = map(object({ client_ipv4_cidrs = optional(set(string), []) }))
  default     = {}
  nullable    = false
}
output "native_material_read_network_bindings" {
  value = module.platform.native_material_read_network_bindings
}
