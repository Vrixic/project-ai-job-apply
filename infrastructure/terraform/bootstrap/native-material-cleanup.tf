variable "native_cleanup_clusters" {
  description = "Retained exact native task clusters for the private native cleanup worker only."
  type        = set(string)
  default     = []
  nullable    = false
  validation {
    condition = length(var.native_cleanup_clusters) <= 8 && alltrue([for cluster in var.native_cleanup_clusters :
      var.aws_region == "us-east-2" && can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", cluster))
    ])
    error_message = "Use at most eight exact same-account us-east-2 native task clusters."
  }
}
