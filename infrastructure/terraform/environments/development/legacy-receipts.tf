variable "legacy_receipt_key_provisioned" {
  type     = bool
  default  = false
  nullable = false
}
variable "legacy_receipt_replay_enabled" {
  type     = bool
  default  = false
  nullable = false
}
variable "legacy_receipt_transition" {
  type    = object({ run_id = string, source_sha = string, snapshot_arn = string, snapshot_created_at = string, expected_applied_migrations = number, expected_legacy_receipts = number, issued_at = string, expires_at = string })
  default = null
}
output "legacy_receipt_key_arn" { value = module.platform.legacy_receipt_key_arn }
output "legacy_receipt_transition_task_definition_arn" { value = module.platform.legacy_receipt_transition_task_definition_arn }
