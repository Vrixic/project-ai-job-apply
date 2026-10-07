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


run "no_original_release_no_service_grant" {
  command = plan
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.platform_kms.statement : statement if startswith(statement.sid, "OriginalResumeDurableEncryption")]) == 0
    error_message = "Empty native releases must not grant durable key use."
  }
}
run "retained_original_functions_have_independent_contexts" {
  command = plan
  variables { native_resume_dispatch_revisions = ["7", "8"] }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.platform_kms.statement : statement if startswith(statement.sid, "OriginalResumeDurableEncryption")]) == 2
    error_message = "Each retained original revision needs a separate encryption context binding."
  }
  assert {
    condition = alltrue([for statement in data.aws_iam_policy_document.platform_kms.statement : (
      toset(statement.actions) == toset(["kms:GenerateDataKey", "kms:Decrypt"]) &&
      length(statement.condition) == 3 &&
      length([for principal in statement.principals : principal if principal.type == "Service" && toset(principal.identifiers) == toset(["lambda.amazonaws.com"])]) == 1 &&
      alltrue([for condition in statement.condition : condition.test == "StringEquals" && toset(condition.values) == toset(condition.variable == "aws:SourceAccount" ? ["111122223333"] : ["arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-durable-r${trimprefix(statement.sid, "OriginalResumeDurableEncryption")}"])])
    ) if startswith(statement.sid, "OriginalResumeDurableEncryption")])
    error_message = "Service key use must bind account, original source function and the same function encryption context."
  }
}
