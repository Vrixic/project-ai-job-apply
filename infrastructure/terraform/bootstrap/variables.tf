variable "aws_region" {
  description = "AWS region for state and deployment identity."
  type        = string
  default     = "us-east-2"
}

variable "environment" {
  description = "Isolated environment name."
  type        = string
  validation {
    condition     = contains(["development", "staging"], var.environment)
    error_message = "Environment must be development or staging."
  }
}

variable "state_bucket_name" {
  description = "Globally unique Terraform state bucket."
  type        = string
}

variable "github_oidc_subject_prefix" {
  description = "Immutable GitHub OIDC repository subject prefix, including owner and repository IDs."
  type        = string
  default     = "repo:Vrixic@92821975/project-ai-job-apply@1315131410"
  validation {
    condition     = can(regex("^repo:[^/@]+@[0-9]+/[^/@]+@[0-9]+$", var.github_oidc_subject_prefix))
    error_message = "GitHub OIDC subject prefix must use the immutable repo:owner@owner-id/repository@repository-id format."
  }
}

variable "github_environment" {
  description = "GitHub Environment allowed to assume the deployment role."
  type        = string
}

variable "candidate_deletion_restore_role_enabled" {
  description = "Separately reviewed read-only boundary allowance for the exact development restore role; changes no existing role's effective permissions."
  type        = bool
  default     = false
  validation {
    condition     = !var.candidate_deletion_restore_role_enabled || var.environment == "development"
    error_message = "Restore-only boundary access is supported only in development."
  }
}
