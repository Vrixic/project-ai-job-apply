variable "restricted_packet_export_enabled" {
  description = "Enable the private candidate-rights reader for encrypted Applications packet values; no packet writer or fingerprint authority."
  type        = bool
  default     = false
  nullable    = false
}
