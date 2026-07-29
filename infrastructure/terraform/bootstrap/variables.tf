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
