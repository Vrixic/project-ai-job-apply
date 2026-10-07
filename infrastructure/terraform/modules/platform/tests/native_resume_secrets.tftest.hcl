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

run "empty_has_no_endpoint" {
  command = plan
  assert {
    condition     = length(aws_vpc_endpoint.secretsmanager) == 0
    error_message = "Empty native inputs must not add an endpoint."
  }
}
run "original_roles_have_separate_exact_secrets" {
  command = apply
  variables {
    native_resume_secret_readers = {
      ai-job-apply-development-resume-owner-r7       = { secret_arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123" }
      ai-job-apply-development-native-resume-r7-task = { secret_arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-Abc123", version_id = "12345678-1234-1234-1234-123456789012" }
    }
    native_resume_secret_security_group_ids = ["sg-0123456789abcdef0"]
  }
  assert {
    condition     = alltrue(flatten([for statement in data.aws_iam_policy_document.secrets_endpoint[0].statement : [for condition in statement.condition : length(condition.values) > 0]]))
    error_message = "Native-only composition must not emit an empty legacy principal condition."
  }

  assert {
    condition     = length(aws_vpc_endpoint.secretsmanager) == 1 && aws_vpc_endpoint.secretsmanager[0].private_dns_enabled
    error_message = "Native-only releases need private secret connectivity."
  }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.secrets_endpoint[0].statement : statement if statement.sid == "aijobapplydevelopmentnativeresumer7task" && statement.resources == toset(["arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-Abc123"]) && length(statement.condition) == 2 && contains(flatten([for condition in statement.condition : condition.values]), "12345678-1234-1234-1234-123456789012") && contains(flatten([for condition in statement.condition : condition.values]), "arn:aws:iam::111122223333:role/ai-job-apply-development-native-resume-r7-task")]) == 1
    error_message = "Task TLS permission must bind its original role, secret and version."
  }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.secrets_endpoint[0].statement : statement if statement.sid == "aijobapplydevelopmentresumeownerr7" && statement.resources == toset(["arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123"]) && length(statement.condition) == 1]) == 1 && contains(flatten([for ingress in aws_security_group.secrets_endpoint[0].ingress : ingress.security_groups]), "sg-0123456789abcdef0")
    error_message = "Owner database permission and reviewed caller network must be connected without task DB access."
  }
}
run "task_requires_version" {
  command = plan
  variables { native_resume_secret_readers = { ai-job-apply-development-native-resume-r7-task = { secret_arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-Abc123" } } }
  expect_failures = [var.native_resume_secret_readers]
}
run "foreign_role_is_refused" {
  command = plan
  variables { native_resume_secret_readers = { ai-job-apply-staging-resume-owner-r7 = { secret_arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123" } } }
  expect_failures = [var.native_resume_secret_readers]
}
