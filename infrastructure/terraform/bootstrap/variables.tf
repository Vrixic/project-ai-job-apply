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

variable "github_repository" {
  description = "GitHub repository in owner/name form."
  type        = string
  default     = "Vrixic/project-ai-job-apply"
}

variable "github_environment" {
  description = "GitHub Environment allowed to assume the deployment role."
  type        = string
}
