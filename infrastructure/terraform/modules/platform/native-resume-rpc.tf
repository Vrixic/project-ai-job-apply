variable "native_resume_task_rpc_bindings" {
  type     = map(object({ owner_function_arn = string, source_function_arn = string }))
  default  = {}
  nullable = false
  validation {
    condition = alltrue([for revision, binding in var.native_resume_task_rpc_bindings :
      can(regex("^[1-9][0-9]{0,8}$", revision)) && alltrue([for kind, arn in { owner = binding.owner_function_arn, source = binding.source_function_arn } :
        can(regex("^arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:${var.name}-${var.environment}-resume-${kind}-r${revision}:[1-9][0-9]{0,8}$", arn))
      ])
    ])
    error_message = "Task RPCs must bind exact same-account original-revision numeric owner/source functions."
  }
}
variable "native_resume_dispatch_revisions" {
  type     = set(string)
  default  = []
  nullable = false
  validation {
    condition     = alltrue([for revision in var.native_resume_dispatch_revisions : can(regex("^[1-9][0-9]{0,8}$", revision))])
    error_message = "Use original numeric task revisions."
  }
}
variable "native_resume_normalized_buckets" {
  type     = map(string)
  default  = {}
  nullable = false
  validation {
    condition     = alltrue([for revision, bucket in var.native_resume_normalized_buckets : can(regex("^[1-9][0-9]{0,8}$", revision)) && can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", bucket))])
    error_message = "Use original numeric revisions and exact reviewed normalized-source buckets."
  }
}
variable "native_resume_original_pdf_buckets" {
  description = "ADR-058: original revisions whose source role may also read the candidate's own retained PDF. Revision to bucket; empty keeps the endpoint to normalized reads only."
  type        = map(string)
  default     = {}
  nullable    = false
  validation {
    condition     = alltrue([for revision, bucket in var.native_resume_original_pdf_buckets : can(regex("^[1-9][0-9]{0,8}$", revision)) && can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", bucket))])
    error_message = "Use original numeric revisions and exact reviewed source buckets."
  }
}
locals {
  native_resume_rpc_configured = length(var.native_resume_task_rpc_bindings) > 0 || length(var.native_resume_dispatch_revisions) > 0
}
