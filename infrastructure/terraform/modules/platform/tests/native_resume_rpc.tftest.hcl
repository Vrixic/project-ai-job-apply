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


run "empty_does_not_add_rpc_endpoint" {
  command = plan

  assert {
    condition     = length(aws_vpc_endpoint.lambda) == 0
    error_message = "Empty native inputs must preserve existing endpoint absence."
  }
}
run "original_rpc_and_normalized_reads" {
  command = plan
  variables {
    native_resume_task_rpc_bindings            = { "7" = { owner_function_arn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-owner-r7:3", source_function_arn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-source-r7:4" } }
    native_resume_dispatch_revisions           = ["7"]
    native_resume_normalized_buckets           = { "7" = "synthetic-normalized" }
    deploy_applications                        = true
    deploy_gateway_lambda                      = true
    gateway_lambda_artifact_s3_key             = "lambda/gateway.zip"
    gateway_lambda_artifact_s3_object_version  = "synthetic-gateway"
    gateway_lambda_artifact_sha256             = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    gateway_lambda_artifact_base64sha256       = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
    gateway_lambda_extension_layer_arn         = "arn:aws:lambda:us-east-2:111122223333:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1"
    deploy_document_intake                     = true
    document_processing_deployment_stage       = "parser-dark"
    document_parser_artifact_s3_key            = "lambda/documents/parser.zip"
    document_parser_artifact_s3_object_version = "parser-version"
    document_parser_artifact_sha256            = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    document_parser_artifact_base64sha256      = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
    document_security_health_rules_enabled     = true
  }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.outbox_lambda_endpoint[0].statement : statement if statement.sid == "OriginalResumeExecutionMetadata7" && statement.actions == toset(["lambda:GetDurableExecution"]) && statement.resources == toset(["arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-durable-r7:*/durable-execution/*"]) && contains(flatten([for condition in statement.condition : condition.values]), "arn:aws:iam::111122223333:role/ai-job-apply-development-resume-observer-r7")]) == 1
    error_message = "Only the original observer may inspect retained original execution metadata."
  }
  assert {
    condition     = length(aws_vpc_endpoint.lambda) == 1 && aws_vpc_endpoint.lambda[0].private_dns_enabled && length(aws_security_group.secrets_endpoint) == 1
    error_message = "Native RPC requires the shared private Lambda endpoint and its ingress group."
  }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.outbox_lambda_endpoint[0].statement : statement if statement.sid == "OriginalResumeTaskRpc7" && statement.resources == toset(["arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-owner-r7:3", "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-source-r7:4"]) && contains(flatten([for condition in statement.condition : condition.values]), "arn:aws:iam::111122223333:role/ai-job-apply-development-native-resume-r7-task")]) == 1
    error_message = "Only the original task role may invoke its two numeric RPCs."
  }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.outbox_lambda_endpoint[0].statement : statement if statement.sid == "OriginalResumeDispatch7" && statement.resources == toset(["arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-durable-r7:*"]) && contains(flatten([for condition in statement.condition : condition.values]), "arn:aws:iam::111122223333:role/ai-job-apply-development-resume-dispatch-r7")]) == 1
    error_message = "Dispatch endpoint scope must remain within the original durable function; role IAM narrows the numeric version."
  }
  assert {
    condition     = length([for statement in data.aws_iam_policy_document.candidate_documents_s3_endpoint[0].statement : statement if statement.sid == "OriginalResumeNormalizedVersion7" && statement.actions == toset(["s3:GetObjectVersion"]) && statement.resources == toset(["arn:aws:s3:::synthetic-normalized/normalized/*/*/*/resume.json"]) && contains(flatten([for condition in statement.condition : condition.values]), "arn:aws:iam::111122223333:role/ai-job-apply-development-resume-source-r7")]) == 1
    error_message = "Only the original source role gets retained normalized-version reads, without object writes or current-object fallback."
  }
}
run "aliases_and_foreign_revision_refused" {
  command = plan
  variables {
    native_resume_task_rpc_bindings = { "7" = { owner_function_arn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-owner-r7:development", source_function_arn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-source-r8:4" } }
  }
  expect_failures = [var.native_resume_task_rpc_bindings]
}
