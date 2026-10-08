mock_provider "aws" {
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::111122223333:role/synthetic-audit" } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-Abc123" } }
  mock_resource "aws_cloudwatch_event_rule" { defaults = { arn = "arn:aws:events:us-east-2:111122223333:rule/ai-job-apply-development-native-material-cleanup-worker" } }

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

run "default_creates_no_repositories" {
  command = plan
  assert {
    condition     = length(aws_ecr_repository.native_material) == 0
    error_message = "Native image repositories must remain opt-in."
  }
}
run "storage_does_not_activate_runtime" {
  command = apply
  variables { native_material_repositories_enabled = true }
  assert {
    condition     = toset([for r in aws_ecr_repository.native_material : r.name]) == toset(["ai-job-apply/native-material", "ai-job-apply/native-resume"]) && alltrue([for r in aws_ecr_repository.native_material : r.image_tag_mutability == "IMMUTABLE" && r.force_delete == false && r.encryption_configuration[0].encryption_type == "KMS" && r.encryption_configuration[0].kms_key == aws_kms_key.platform.arn && r.image_scanning_configuration[0].scan_on_push])
    error_message = "Both exact repositories must retain immutable, scanned, platform-encrypted images without force deletion."
  }
  assert {
    condition     = length(aws_lambda_function.native_cleanup) == 0 && length(aws_cloudwatch_event_rule.native_cleanup) == 0 && !var.native_cleanup_enabled && !var.native_cleanup_schedule_enabled
    error_message = "Image storage must not deploy or activate cleanup."
  }
}
