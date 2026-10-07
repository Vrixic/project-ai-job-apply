mock_provider "aws" {
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::111122223333:role/synthetic-audit" } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-Abc123" } }
  mock_resource "aws_cloudwatch_event_rule" { defaults = { arn = "arn:aws:events:us-east-2:111122223333:rule/ai-job-apply-development-job-retention" } }

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

run "absent_by_default" {
  command = plan
  assert {
    condition     = length(aws_lambda_function.job_retention) == 0 && length(aws_cloudwatch_event_rule.job_retention) == 0 && length(aws_iam_role.job_retention) == 0
    error_message = "No release means no audit runtime or schedule."
  }
}
run "immutable_private_release_stays_disabled" {
  command = apply
  variables {
    job_retention_release = {
      source_sha            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      artifact_sha256       = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      artifact_base64sha256 = "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s="
      artifact_version      = "synthetic-version"
      artifact_key          = "lambda/jobs/retention/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/job-retention-lambda.zip"
      extension_layer_arn   = "arn:aws:lambda:us-east-2:111122223333:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1"
    }
  }
  assert {
    condition     = length(aws_vpc_endpoint.secretsmanager) == 1 && aws_vpc_endpoint.secretsmanager[0].private_dns_enabled && contains(flatten([for statement in data.aws_iam_policy_document.secrets_endpoint[0].statement : flatten([for condition in statement.condition : condition.values])]), aws_iam_role.job_retention[0].arn)
    error_message = "A standalone maintenance release must provision private secret connectivity and allow its exact role."
  }

  assert {
    condition     = aws_cloudwatch_event_rule.job_retention[0].state == "DISABLED" && aws_lambda_function.job_retention[0].environment[0].variables.JOB_RETENTION_ENABLED == "false" && aws_lambda_function.job_retention[0].environment[0].variables.JOB_RETENTION_BATCH_LIMIT == "100"
    error_message = "Deployment alone must not authorize expiry or scheduled invocation."
  }
  assert {
    condition     = aws_cloudwatch_event_target.job_retention[0].arn == aws_lambda_function.job_retention[0].qualified_arn && aws_lambda_permission.job_retention[0].qualifier == aws_lambda_function.job_retention[0].version && jsondecode(aws_cloudwatch_event_target.job_retention[0].input).action == "expire" && aws_lambda_function.job_retention[0].s3_object_version == "synthetic-version"
    error_message = "Invocation must bind numeric artifact and the closed scalar expiry envelope."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.job_retention[0].policy).Statement[2].Resource == aws_secretsmanager_secret.database_url.arn && contains(jsondecode(aws_iam_role_policy.job_retention[0].policy).Statement[4].Action, "s3:*") && length(aws_cloudwatch_metric_alarm.job_retention) == 2
    error_message = "Maintenance needs the owning secret, explicit content denial and delivery/execution alarms."
  }
}
run "activation_requires_release" {
  command = plan
  variables { job_retention_enabled = true }
  expect_failures = [var.job_retention_release]
}
run "schedule_requires_runtime" {
  command = plan
  variables { job_retention_schedule_enabled = true }
  expect_failures = [var.job_retention_schedule_enabled]
}

