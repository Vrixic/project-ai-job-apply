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
locals {
  native_cleanup_boundary_statements = [for index, cluster in sort(tolist(var.native_cleanup_clusters)) : {
    Sid      = "NativeCleanup${index}", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"],
    Resource = "${replace(cluster, ":cluster/", ":task/")}/*",
    Condition = { ArnEquals = {
      "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-native-material-cleanup-worker",
      "ecs:cluster"      = cluster
    } }
  }]
}
