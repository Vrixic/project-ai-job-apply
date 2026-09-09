variable "candidate_deletion_restore_role_enabled" {
  description = "Separately reviewed default-off restore-only role; creates no executor, restore, or trigger."
  type        = bool
  default     = false
}
