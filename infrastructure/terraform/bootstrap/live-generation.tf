variable "live_generation_model" {
  description = "ADR-059: the one reviewed Amazon Bedrock inference profile the native resume task roles may invoke. A model enters live-generation-models.json only after its AWS retention statements were re-read and recorded in ADR-059. Null grants nothing."
  type        = string
  default     = null
  validation {
    condition     = var.live_generation_model == null ? true : (var.aws_region == "us-east-2" && contains(keys(local.live_generation_models), var.live_generation_model))
    error_message = "Use a model listed in infrastructure/terraform/live-generation-models.json, in us-east-2."
  }
}
locals {
  live_generation_models = jsondecode(file("${path.module}/../live-generation-models.json")).models
  # A ceiling, not a grant: the environment gives each native resume task role the exact inference profile and foundation
  # models, and only while live generation is switched on. The foundation model region is a wildcard here only to keep the
  # boundary inside IAM's size limit (the profile routes inside the US regions); the role policy names every region.
  live_generation_boundary_statements = var.live_generation_model == null ? [] : [{
    Sid = "LiveGeneration", Effect = "Allow", Action = ["bedrock:InvokeModel"],
    Resource = [
      "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.live_generation_model}",
      "arn:aws:bedrock:*::foundation-model/${local.live_generation_models[var.live_generation_model].foundationModelId}"
    ],
    Condition = { ArnLike = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-native-resume-r*-task" } }
  }]
}
