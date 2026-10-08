variable "native_material_tls_managed" {
  description = "Manage native development TLS/account secret metadata; import existing secrets before applying. Secret values and versions remain outside Terraform."
  type        = bool
  default     = false
  nullable    = false
}

variable "native_material_tls_imports" {
  description = "Optional existing secret ARNs for a reviewed declarative import; never secret values."
  type        = map(string)
  default     = {}
  nullable    = false
  validation {
    condition = alltrue([for name, arn in var.native_material_tls_imports :
      var.native_material_tls_managed && contains(["tls", "acme-account"], name) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:ai-job-apply/development/native-material/${name}-[A-Za-z0-9]{6}$", arn))
    ])
    error_message = "Imports require managed development TLS metadata and exact TLS/account secret ARNs."
  }
}

import {
  for_each = var.native_material_tls_imports
  to       = aws_secretsmanager_secret.native_material_tls[each.key]
  id       = each.value
}

data "aws_kms_alias" "native_material_tls" {
  count = var.native_material_tls_managed ? 1 : 0
  name  = "alias/ai-job-apply-development"
}

resource "aws_secretsmanager_secret" "native_material_tls" {
  for_each                = var.native_material_tls_managed ? toset(["tls", "acme-account"]) : toset([])
  name                    = "ai-job-apply/development/native-material/${each.key}"
  kms_key_id              = data.aws_kms_alias.native_material_tls[0].target_key_arn
  recovery_window_in_days = 30
  tags                    = { Purpose = "native-material-tls" }

  lifecycle {
    prevent_destroy = true
  }
}

output "native_material_tls_secrets" {
  description = "Secret metadata ARNs only; original task releases must separately pin the reviewed TLS version."
  value       = { for name, secret in aws_secretsmanager_secret.native_material_tls : name => secret.arn }
}
