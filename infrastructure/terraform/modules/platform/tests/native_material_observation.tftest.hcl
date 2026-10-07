mock_provider "aws" {
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:us-east-2:111122223333:ai-job-apply-development-operations" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } }

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



run "absent" {
  command = plan
  assert {
    condition     = length(aws_sqs_queue.native_material_events) == 0 && length(aws_cloudwatch_metric_alarm.native_material_events) == 0
    error_message = "Default adds no material event resources."
  }
}
run "original_failure_retention" {
  command = plan
  variables { native_material_observation_releases = { r1 = { kms_key_arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } } }
  assert {
    condition     = aws_sqs_queue.native_material_events["r1"].message_retention_seconds == 1209600 && length(aws_cloudwatch_metric_alarm.native_material_events) == 10 && jsondecode(aws_sqs_queue_policy.native_material_events["r1"].policy).Statement[0].Condition.ArnEquals["aws:SourceArn"] == local.material_event_rules.r1 && jsondecode(aws_sqs_queue_policy.native_material_events["r1"].policy).Statement[1].Condition.Bool["aws:SecureTransport"] == "false"
    error_message = "Retain encrypted original failures for fourteen days, TLS-only, with all ten failure signals monitored."
  }
  assert {
    condition     = length([for s in data.aws_iam_policy_document.platform_kms.statement : s if s.sid == "MaterialEventFailurer1" && s.actions == toset(["kms:GenerateDataKey", "kms:Decrypt"])]) == 1
    error_message = "Original EventBridge delivery requires a scoped key grant."
  }
}
run "foreign_key_refused" {
  command = plan
  variables { native_material_observation_releases = { r1 = { kms_key_arn = "arn:aws:kms:us-east-2:999900001111:key/12345678-1234-4234-8234-123456789012" } } }
  expect_failures = [var.native_material_observation_releases]
}
