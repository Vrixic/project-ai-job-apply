mock_provider "aws" {
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

  mock_resource "aws_cloudformation_stack" {
    defaults = {
      outputs = {
        DurableAliasArn   = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-profile-readiness-durable:development"
        DurableVersionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-profile-readiness-durable:1"
      }
    }
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
  name        = "ai-job-apply"
  environment = "development"
  vpc_cidr    = "10.30.0.0/16"

  oidc_issuer                               = "https://example.auth0.com/"
  oidc_audience                             = "https://api.example.invalid"
  deploy_applications                       = true
  deploy_gateway_lambda                     = true
  gateway_lambda_artifact_s3_key            = "lambda/gateway.zip"
  gateway_lambda_artifact_s3_object_version = "gateway-version"
  gateway_lambda_artifact_sha256            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  gateway_lambda_artifact_base64sha256      = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
  gateway_lambda_extension_layer_arn        = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"

  deploy_serverless_outbox                              = true
  workflow_ingress_artifact_s3_key                      = "lambda/workflow-ingress.zip"
  workflow_ingress_artifact_s3_object_version           = "ingress-version"
  workflow_ingress_artifact_sha256                      = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  workflow_ingress_artifact_base64sha256                = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI="
  workflow_ingress_lambda_extension_layer_arn           = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  deploy_profile_readiness_durable                      = true
  profile_readiness_durable_artifact_s3_key             = "lambda/profile/durable.zip"
  profile_readiness_durable_artifact_s3_object_version  = "durable-version"
  profile_readiness_durable_artifact_sha256             = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  profile_readiness_durable_artifact_base64sha256       = "Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2M="
  profile_readiness_activity_artifact_s3_key            = "lambda/profile/activity.zip"
  profile_readiness_activity_artifact_s3_object_version = "activity-version"
  profile_readiness_activity_artifact_sha256            = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  profile_readiness_activity_artifact_base64sha256      = "ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGQ="
  profile_readiness_lambda_extension_layer_arn          = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  ingestion_durable_artifact_s3_key                     = "lambda/ingestion/durable.zip"
  ingestion_durable_artifact_s3_object_version          = "ingestion-durable-version"
  ingestion_durable_artifact_sha256                     = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  ingestion_durable_artifact_base64sha256               = "ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU="
  ingestion_runtime_artifact_s3_key                     = "lambda/ingestion/runtime.zip"
  ingestion_runtime_artifact_s3_object_version          = "ingestion-runtime-version"
  ingestion_runtime_artifact_sha256                     = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  ingestion_runtime_artifact_base64sha256               = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
  ingestion_lambda_extension_layer_arn                  = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  candidate_rights_auth0_secret_provisioned             = true
  candidate_rights_auth0_authorized_owner               = "authorized-operator"
  candidate_rights_id_token_audience                    = "candidate-web-client"
}

# The read of the candidate's own uploaded resume (ADR-050) is off by default and can never be switched on
# without the Gateway's tailoring invoke path, which is what it is served through.
run "off_by_default" {
  command = plan
  assert {
    condition     = !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "UPLOADED_RESUME_ATTACHMENT_ENABLED")
    error_message = "The uploaded-resume read must be dark unless it is explicitly enabled."
  }
}

run "refuses_without_tailoring_invoke" {
  command = plan
  variables {
    uploaded_resume_attachment_enabled = true
    document_tailoring_invoke_enabled  = false
  }
  expect_failures = [var.uploaded_resume_attachment_enabled]
}

run "no_flag_while_the_invoke_path_is_not_deployed" {
  command = plan
  variables {
    uploaded_resume_attachment_enabled = true
    document_tailoring_invoke_enabled  = true
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "UPLOADED_RESUME_ATTACHMENT_ENABLED")
    error_message = "The flag may only reach the Gateway when the processor alias is actually deployed and invokable."
  }
}
