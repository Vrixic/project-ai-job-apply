variable "candidate_deletion_restore_role_enabled" {
  description = "Restore-only development execution is unavailable in staging."
  type        = bool
  default     = false
  validation {
    condition     = !var.candidate_deletion_restore_role_enabled
    error_message = "Candidate deletion restore execution is restricted to separately reviewed development."
  }
}
