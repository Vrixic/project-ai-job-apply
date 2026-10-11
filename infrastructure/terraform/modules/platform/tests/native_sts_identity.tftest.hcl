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
  name                                          = "ai-job-apply"
  environment                                   = "development"
  vpc_cidr                                      = "10.20.0.0/16"
  oidc_issuer                                   = "https://example.auth0.com/"
  oidc_audience                                 = "https://api.example.invalid"
  deploy_applications                           = true
  deploy_gateway_lambda                         = true
  gateway_lambda_artifact_s3_key                = "lambda/gateway.zip"
  gateway_lambda_artifact_s3_object_version     = "synthetic-gateway"
  gateway_lambda_artifact_sha256                = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  gateway_lambda_artifact_base64sha256          = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
  gateway_lambda_extension_layer_arn            = "arn:aws:lambda:us-east-2:111122223333:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1"
  deploy_document_intake                        = true
  document_processing_deployment_stage          = "complete-dark"
  document_parser_invocation_qualified_arn      = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-document-parser:1"
  document_processor_artifact_s3_key            = "lambda/documents/processor.zip"
  document_processor_artifact_s3_object_version = "processor-version"
  document_processor_artifact_sha256            = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  document_processor_artifact_base64sha256      = "ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU="
  document_parser_artifact_s3_key               = "lambda/documents/parser.zip"
  document_parser_artifact_s3_object_version    = "parser-version"
  document_parser_artifact_sha256               = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  document_parser_artifact_base64sha256         = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
  document_processor_extension_layer_arn        = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
}
run "documents_only_has_no_native_identity_grant" {
  command = plan
  assert {
    condition     = length(data.aws_iam_policy_document.document_sts_endpoint[0].statement) == 1 && one(data.aws_iam_policy_document.document_sts_endpoint[0].statement).actions == toset(["sts:AssumeRole"])
    error_message = "Document-only deployment must retain its sole existing AssumeRole grant."
  }
}
run "native_identity_is_exact_and_does_not_expand_assume_role" {
  command = plan
  variables {
    native_resume_task_rpc_bindings = { "7" = { owner_function_arn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-owner-r7:3", source_function_arn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-source-r7:4" } }
    native_material_task_access = { "3" = {
      owner_function_arn         = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:9"
      provider_secret_arn        = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/provider-abc123"
      provider_secret_version_id = "12345678-1234-4234-8234-123456789012"
      tls_secret_arn             = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-abc123"
      tls_secret_version_id      = "22345678-1234-4234-8234-123456789012"
      security_group_ids         = ["sg-22222222222222222"]
    } }
  }
  assert {
    condition     = length(data.aws_iam_policy_document.document_sts_endpoint[0].statement) == 3 && alltrue([for s in data.aws_iam_policy_document.document_sts_endpoint[0].statement : s.actions == toset(["sts:GetCallerIdentity"]) && s.resources == toset(["*"]) && length(s.condition) == 1 && one(s.condition).test == "ArnEquals" && one(s.condition).variable == "aws:PrincipalArn" && one(s.condition).values == tolist([s.sid == "OriginalResumeTaskIdentity7" ? "arn:aws:iam::111122223333:role/ai-job-apply-development-native-resume-r7-task" : "arn:aws:iam::111122223333:role/ai-job-apply-development-native-material-r3-task"]) if s.sid != "CoordinatorAssumesExactDocumentObjectRoleOnly"])
    error_message = "Identity grants must allow only GetCallerIdentity for each exact original task role."
  }
  assert {
    condition     = one([for s in data.aws_iam_policy_document.document_sts_endpoint[0].statement : s if s.sid == "CoordinatorAssumesExactDocumentObjectRoleOnly"]).actions == toset(["sts:AssumeRole"]) && one([for s in data.aws_iam_policy_document.document_sts_endpoint[0].statement : s if s.sid == "CoordinatorAssumesExactDocumentObjectRoleOnly"]).resources == toset([local.document_parser_object_access_role_arn]) && one(one([for s in data.aws_iam_policy_document.document_sts_endpoint[0].statement : s if s.sid == "CoordinatorAssumesExactDocumentObjectRoleOnly"]).condition).values == tolist([local.document_processor_role_arn])
    error_message = "Native identity access must not broaden document role assumption."
  }
}
