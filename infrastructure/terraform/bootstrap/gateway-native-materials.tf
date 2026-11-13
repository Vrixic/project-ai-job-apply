variable "gateway_packet_fingerprint_key_arn" {
  description = "Optional exact retained packet HMAC key for the existing Gateway boundary. Grants no other principal or cryptographic operation."
  type        = string
  default     = null
  validation {
    condition     = var.gateway_packet_fingerprint_key_arn == null ? true : (var.aws_region == "us-east-2" && can(regex("^arn:aws:kms:us-east-2:${data.aws_caller_identity.current.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", var.gateway_packet_fingerprint_key_arn)))
    error_message = "Use the exact same-account us-east-2 packet fingerprint key ARN."
  }
}
locals {
  gateway_packet_boundary_statements = var.gateway_packet_fingerprint_key_arn == null ? [] : [{
    Sid = "GatewayPacketFingerprint", Effect = "Allow", Action = ["kms:GenerateMac"], Resource = var.gateway_packet_fingerprint_key_arn,
    Condition = {
      ArnEquals    = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-gateway-lambda" }
      StringEquals = { "kms:MacAlgorithm" = "HMAC_SHA_256" }
    }
  }]
}

variable "gateway_native_disposal_clusters" {
  description = "Retained exact native task clusters for Gateway terminal application cleanup only."
  type        = set(string)
  default     = []
  nullable    = false
  validation {
    condition = length(var.gateway_native_disposal_clusters) <= 8 && alltrue([for cluster in var.gateway_native_disposal_clusters :
      var.aws_region == "us-east-2" && can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", cluster))
    ])
    error_message = "Use at most eight exact same-account us-east-2 native task clusters."
  }
}
locals {
  # Statement ids kept in the workload boundary (matched by prefix); every other id is dropped to save space.
  workload_boundary_retained_sids = [
    "ConnectExactPublicJobReader", "SendEmail", "OperateOwnedServerlessWorkflows", "ListCandidateDataExportVersions",
    "PurgeDeletedCandidateDocumentVersions", "RestoreOnly", "GatewayNativeDisposal", "NativeCleanup", "ResumePurgeNativeTask"
  ]
  # The candidate-rights maintenance function may DESCRIBE (never stop) tasks in the clusters the Gateway and the cleanup
  # worker already retain, so a resume purge can tell that a native task is gone (Documents migration 0021). The statement
  # is bound to that one role; without it the platform grant is denied by this boundary, and no other role gains anything.
  candidate_rights_native_task_boundary_statements = [for index, cluster in sort(distinct(concat(tolist(var.gateway_native_disposal_clusters), tolist(var.native_cleanup_clusters)))) : {
    Sid      = "ResumePurgeNativeTask${index}", Effect = "Allow", Action = ["ecs:DescribeTasks"],
    Resource = "${replace(cluster, ":cluster/", ":task/")}/*",
    Condition = { ArnEquals = {
      "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-profile-readiness-activity",
      "ecs:cluster"      = cluster
    } }
  }]
  gateway_disposal_boundary_statements = [for index, cluster in sort(tolist(var.gateway_native_disposal_clusters)) : {
    Sid      = "GatewayNativeDisposal${index}", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"],
    Resource = "${replace(cluster, ":cluster/", ":task/")}/*",
    Condition = { ArnEquals = {
      "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-gateway-lambda",
      "ecs:cluster"      = cluster
    } }
  }]
}
