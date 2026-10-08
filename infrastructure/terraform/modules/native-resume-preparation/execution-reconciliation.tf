variable "execution_reconciliation_enabled" {
  type     = bool
  default  = false
  nullable = false
  validation {
    condition     = !var.execution_reconciliation_enabled || var.execution_inspection_enabled
    error_message = "Scheduled execution reconciliation requires original receipt inspection."
  }
}
resource "aws_cloudwatch_event_rule" "execution_reconciliation" {
  count               = local.deployed ? 1 : 0
  name                = "${local.names.observer}-executions"
  schedule_expression = "rate(1 minute)"
  state               = var.execution_reconciliation_enabled ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "execution_reconciliation" {
  count     = local.deployed ? 1 : 0
  rule      = aws_cloudwatch_event_rule.execution_reconciliation[0].name
  target_id = "original-resume-execution-observation"
  arn       = aws_lambda_function.observer[0].qualified_arn
  input     = jsonencode({ schemaVersion = 1, action = "reconcile_executions" })
  dead_letter_config { arn = var.release.observer_dead_letter_arn }
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 5
  }
}
resource "aws_lambda_permission" "execution_reconciliation" {
  count          = local.deployed ? 1 : 0
  statement_id   = "ExactResumeExecutionObservation"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.observer[0].function_name
  qualifier      = aws_lambda_function.observer[0].version
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.execution_reconciliation[0].arn
  source_account = var.account_id
}
