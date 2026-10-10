variable "application_restore_reconciliation" {
  type = object({
    run_id     = string
    source_sha = string
    image      = string
    issued_at  = string
    expires_at = string
  })
  default = null
}

output "application_restore_reconciliation_task_definition_arn" {
  value = module.platform.application_restore_reconciliation_task_definition_arn
}
