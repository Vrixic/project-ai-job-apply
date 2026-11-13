mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "111122223333" } }
  mock_data "aws_region" { defaults = { region = "us-east-2" } }
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
}
mock_provider "aws" {
  alias = "billing"
}

variables {
  name                        = "ai-job-apply"
  environment                 = "development"
  operational_alert_topic_arn = "arn:aws:sns:us-east-2:111122223333:ai-job-apply-development-operations"
  monthly_budget_amount_usd   = 5
  actual_cost_alerts_usd      = [5]
}

run "no_live_generation_budget_by_default" {
  command = plan
  assert {
    condition     = length(aws_budgets_budget.live_generation) == 0 && output.live_generation_budget_name == null
    error_message = "No live generation budget may exist unless the ceiling is configured."
  }
}

run "live_generation_budget_alerts_at_fifty_and_eighty_percent_of_twenty_dollars" {
  command = plan
  variables {
    live_generation_budget = {
      amount_usd        = 20
      services          = ["Claude Sonnet 4.6 (Amazon Bedrock Edition)"]
      alert_percentages = [50, 80]
    }
  }
  assert {
    condition = (
      aws_budgets_budget.live_generation[0].limit_amount == "20" &&
      aws_budgets_budget.live_generation[0].limit_unit == "USD" &&
      aws_budgets_budget.live_generation[0].time_unit == "MONTHLY" &&
      aws_budgets_budget.live_generation[0].name == "ai-job-apply-development-live-generation" &&
      toset([for n in aws_budgets_budget.live_generation[0].notification : n.threshold]) == toset([50, 80]) &&
      alltrue([for n in aws_budgets_budget.live_generation[0].notification : n.threshold_type == "PERCENTAGE" && n.notification_type == "ACTUAL" && n.comparison_operator == "GREATER_THAN" && n.subscriber_sns_topic_arns == toset(["arn:aws:sns:us-east-2:111122223333:ai-job-apply-development-operations"])])
    )
    error_message = "The ceiling must alert the operational topic at 50% and 80% of actual spend."
  }
  assert {
    condition     = one(aws_budgets_budget.live_generation[0].cost_filter).name == "Service" && jsonencode(one(aws_budgets_budget.live_generation[0].cost_filter).values) == jsonencode(["Claude Sonnet 4.6 (Amazon Bedrock Edition)"])
    error_message = "The ceiling must track only the named model service, not the whole account."
  }
}

run "live_generation_budget_needs_a_named_service" {
  command = plan
  variables {
    live_generation_budget = { amount_usd = 20, services = [], alert_percentages = [50, 80] }
  }
  expect_failures = [var.live_generation_budget]
}

run "live_generation_budget_rejects_a_percentage_over_one_hundred" {
  command = plan
  variables {
    live_generation_budget = { amount_usd = 20, services = ["Claude Sonnet 4.6 (Amazon Bedrock Edition)"], alert_percentages = [50, 120] }
  }
  expect_failures = [var.live_generation_budget]
}
