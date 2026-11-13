output "monthly_budget_name" {
  value = aws_budgets_budget.monthly_cost.name
}

output "cost_export_arn" {
  value = aws_bcmdataexports_export.cost_and_usage.export[0].export_arn
}

output "cost_export_bucket" {
  value = aws_s3_bucket.cost_exports.bucket
}

output "live_generation_budget_name" {
  value = var.live_generation_budget == null ? null : aws_budgets_budget.live_generation[0].name
}
