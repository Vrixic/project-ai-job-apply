variable "native_resume_secret_readers" {
  description = "Exact original resume roles and immutable secret bindings; no secret values."
  type        = map(object({ secret_arn = string, version_id = optional(string) }))
  default     = {}
  nullable    = false
  validation {
    condition = alltrue([for role, binding in var.native_resume_secret_readers :
      can(regex("^${var.name}-${var.environment}-(resume-(owner|source|control|dispatch|observer)-r[1-9][0-9]{0,8}|native-resume-r[1-9][0-9]{0,8}-task)$", role)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${data.aws_caller_identity.current.account_id}:secret:${var.name}/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", binding.secret_arn)) &&
      (endswith(role, "-task") ? can(regex("^[A-Za-z0-9-]{32,64}$", binding.version_id)) : binding.version_id == null)
    ]) && (length(var.native_resume_secret_readers) == 0 || data.aws_region.current.region == "us-east-2")
    error_message = "Use exact original environment roles/secrets; task TLS requires its immutable version and the us-east-2 platform."
  }
}
variable "native_resume_secret_security_group_ids" {
  type     = set(string)
  default  = []
  nullable = false
  validation {
    condition     = alltrue([for id in var.native_resume_secret_security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))])
    error_message = "Use exact reviewed resume caller security groups."
  }
}
