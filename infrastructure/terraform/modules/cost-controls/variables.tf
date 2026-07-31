variable "name" {
  type = string
}

variable "environment" {
  type = string
}

variable "operational_alert_topic_arn" {
  description = "Same-account encrypted SNS topic used for actual-cost budget alerts."
  type        = string
}

variable "monthly_budget_amount_usd" {
  description = "Monthly cost budget reference amount. AWS Budgets alerts but does not cap spend."
  type        = number

  validation {
    condition     = var.monthly_budget_amount_usd > 0
    error_message = "The monthly budget amount must be positive."
  }
}

variable "actual_cost_alerts_usd" {
  description = "Ascending absolute actual-cost thresholds published to the operational alert topic."
  type        = list(number)

  validation {
    condition = (
      length(var.actual_cost_alerts_usd) > 0 &&
      alltrue([for amount in var.actual_cost_alerts_usd : amount > 0]) &&
      alltrue([
        for index, amount in var.actual_cost_alerts_usd :
        index == 0 ? true : amount > var.actual_cost_alerts_usd[index - 1]
      ]) &&
      length(distinct(var.actual_cost_alerts_usd)) == length(var.actual_cost_alerts_usd)
    )
    error_message = "Actual-cost thresholds must be unique, positive, and ascending."
  }
}

variable "export_retention_days" {
  description = "Days to retain current CUR 2.0 export objects for billing reconciliation."
  type        = number
  default     = 400

  validation {
    condition     = var.export_retention_days >= 365 && floor(var.export_retention_days) == var.export_retention_days
    error_message = "Cost exports must be retained for at least 365 whole days."
  }
}
