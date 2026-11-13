# ADR-059: live generation of resumes and cover letters through Amazon Bedrock. Everything here is off unless the
# variable is set; `enabled` is the kill switch and defaults to off.

variable "live_generation" {
  description = "ADR-059 live generation. Null creates nothing. model must be listed in infrastructure/terraform/live-generation-models.json (an AWS retention review recorded in the ADR). enabled is the kill switch: false removes the native task roles' permission to invoke the model without a release. budget_services are the Cost Explorer service names that carry the model's cost (named after the model; confirm them in Cost Explorer after the first calls). The budget alerts at 50% and 80% and does not cap spend; the kill switch is the hard stop."
  type = object({
    model                      = string
    enabled                    = optional(bool, false)
    monthly_budget_usd         = optional(number, 20)
    budget_services            = list(string)
    budget_alert_percentages   = optional(list(number), [50, 80])
    burst_invocations_per_hour = optional(number, 30)
  })
  default = null
  validation {
    condition     = var.live_generation == null ? true : contains(keys(local.live_generation_models), var.live_generation.model)
    error_message = "Use a model listed in infrastructure/terraform/live-generation-models.json."
  }
}

locals {
  live_generation_models = jsondecode(file("${path.module}/../../live-generation-models.json")).models
  live_generation_model  = var.live_generation == null ? null : local.live_generation_models[var.live_generation.model]
  # Task security groups and role revisions come from the native resume releases already composed in this environment.
  live_generation_task_security_group_ids = toset(flatten([for item in values(var.native_resume_preparation_releases) : item.release.task_security_group_ids]))
  live_generation_task_role_revisions     = toset([for item in values(var.native_resume_task_releases) : element(reverse(split(":", item.release.expected_task_definition_arn)), 0)])
  platform_live_generation = var.live_generation == null ? null : {
    profile_id                 = var.live_generation.model
    foundation_model_id        = local.live_generation_model.foundationModelId
    destination_regions        = local.live_generation_model.destinationRegions
    task_role_revisions        = local.live_generation_task_role_revisions
    task_security_group_ids    = local.live_generation_task_security_group_ids
    burst_invocations_per_hour = var.live_generation.burst_invocations_per_hour
  }
  live_generation_budget = var.live_generation == null ? null : {
    amount_usd        = var.live_generation.monthly_budget_usd
    services          = var.live_generation.budget_services
    alert_percentages = var.live_generation.budget_alert_percentages
  }
  # Passed to every native resume task release; the module grants invoke only while enabled.
  task_live_generation = var.live_generation == null ? null : {
    enabled               = var.live_generation.enabled
    profile_arn           = module.platform.live_generation_profile_arn
    foundation_model_arns = module.platform.live_generation_foundation_model_arns
  }
}

output "live_generation_bindings" {
  description = "Review-only: what live generation created and whether the kill switch is on."
  value = var.live_generation == null ? null : {
    model                 = var.live_generation.model
    enabled               = var.live_generation.enabled
    profile_arn           = module.platform.live_generation_profile_arn
    foundation_model_arns = module.platform.live_generation_foundation_model_arns
    budget_name           = module.cost_controls.live_generation_budget_name
  }
}
