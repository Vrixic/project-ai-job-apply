variable "private_service_endpoints_enabled" {
  description = "Retain private interface endpoints; false is only for verified drained prelaunch shutdown."
  type        = bool
  default     = true
  nullable    = false
}
