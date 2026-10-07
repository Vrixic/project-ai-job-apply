mock_provider "aws" {
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:us-east-2:111122223333:ai-job-apply-development-operations" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012" } }

  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-2a", "us-east-2b"] }
  }

  mock_data "aws_region" {
    defaults = { region = "us-east-2", name = "us-east-2" }
  }

  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }

  mock_data "aws_iam_policy" {
    defaults = {
      arn = "arn:aws:iam::111122223333:policy/ai-job-apply-development-workload-boundary"
    }
  }

  mock_data "aws_prefix_list" {
    defaults = { id = "pl-s3gateway" }
  }

  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }

  mock_resource "aws_lambda_function" {
    defaults = {
      version       = "1"
      qualified_arn = "arn:aws:lambda:us-east-2:111122223333:function:mock:1"
    }
  }

  mock_resource "aws_lambda_alias" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-2:111122223333:function:mock:development"
      invoke_arn = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:111122223333:function:mock:development/invocations"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      resource_id = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      address     = "database.cluster.us-east-2.rds.amazonaws.com"
      port        = 5432
      db_name     = "ai_job_apply"
    }
  }
}

mock_provider "random" {}
mock_provider "time" {}


variables {
  name          = "ai-job-apply"
  environment   = "development"
  vpc_cidr      = "10.20.0.0/16"
  oidc_issuer   = "https://example.auth0.com/"
  oidc_audience = "https://api.example.invalid"
}
run "empty_has_no_failure_resources" {
  command = plan
  assert {
    condition     = length(aws_sqs_queue.native_resume_observation) == 0 && length(aws_cloudwatch_metric_alarm.native_resume_observation) == 0
    error_message = "No release must preserve existing resources."
  }
}
run "original_failures_are_retained_and_alerted" {
  command = apply
  variables {
    native_resume_observation_releases = { "7" = {
      queue_arn   = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-resume-observer-r7-dlq"
      kms_key_arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012"
    } }
  }
  assert {
    condition     = aws_sqs_queue.native_resume_observation["7"].message_retention_seconds == 1209600 && aws_sqs_queue.native_resume_observation["7"].kms_master_key_id == aws_kms_key.platform.arn
    error_message = "Failed observations need fourteen-day customer-key retention."
  }
  assert {
    condition     = jsondecode(aws_sqs_queue_policy.native_resume_observation["7"].policy).Statement[0].Condition.ArnEquals["aws:SourceArn"] == "arn:aws:events:us-east-2:111122223333:rule/ai-job-apply-development-resume-observer-r7" && jsondecode(aws_sqs_queue_policy.native_resume_observation["7"].policy).Statement[1].Effect == "Deny"
    error_message = "Queue policy must bind the original rule and require TLS."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.native_resume_observation) == 3 && alltrue([for alarm in aws_cloudwatch_metric_alarm.native_resume_observation : alarm.alarm_actions == toset([aws_sns_topic.operational_alerts.arn])])
    error_message = "Queued failures and both failed-DLQ delivery paths need alerts."
  }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.platform_kms.statement : statement if statement.sid == "OriginalResumeObservationFailureEncryption" && contains(flatten([for condition in statement.condition : condition.values]), "arn:aws:events:us-east-2:111122223333:rule/ai-job-apply-development-resume-observer-r7")]) == 1
    error_message = "Encryption permission must bind the original event rule."
  }
}
