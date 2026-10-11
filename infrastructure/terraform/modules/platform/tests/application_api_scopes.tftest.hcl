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
      arn = "arn:aws:iam::111122223333:policy/ai-job-apply-staging-workload-boundary"
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
        DurableAliasArn   = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:staging"
        DurableVersionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:1"
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
      arn        = "arn:aws:lambda:us-east-2:111122223333:function:mock:staging"
      invoke_arn = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:111122223333:function:mock:staging/invocations"
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
  environment = "staging"
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

override_resource {
  target          = aws_apigatewayv2_authorizer.gateway[0]
  override_during = plan
  values          = { id = "synthetic-jwt-authorizer" }
}
override_resource {
  target          = aws_apigatewayv2_integration.gateway_lambda[0]
  override_during = plan
  values          = { id = "synthetic-gateway-integration" }
}
run "applications_only_scope_reaches_jwt_gateway_without_document_intake" {
  command = plan
  variables {
    serverless_runtime_enabled = true
  }
  assert {
    condition = (
      aws_apigatewayv2_route.gateway[0].authorization_type == "JWT" &&
      aws_apigatewayv2_route.gateway[0].authorizer_id == aws_apigatewayv2_authorizer.gateway[0].id &&
      aws_apigatewayv2_route.gateway[0].target == "integrations/${aws_apigatewayv2_integration.gateway_lambda[0].id}" &&
      toset(aws_apigatewayv2_route.gateway[0].authorization_scopes) == toset([
        "applications:read", "applications:write", "jobs:moderate", "jobs:read", "jobs:write", "profile:read", "profile:write"
      ])
    )
    error_message = "Application-only clients must reach the authenticated Gateway; exact controller and owner checks still authorize each operation."
  }
}
run "applications_only_scope_reaches_jwt_gateway_with_document_intake" {
  command = plan
  variables {
    serverless_runtime_enabled     = true
    deploy_document_intake         = true
    private_application_networking = true
  }
  assert {
    condition = (
      aws_apigatewayv2_route.gateway[0].authorization_type == "JWT" &&
      aws_apigatewayv2_route.gateway[0].authorizer_id == aws_apigatewayv2_authorizer.gateway[0].id &&
      toset(aws_apigatewayv2_route.gateway[0].authorization_scopes) == toset([
        "applications:read", "applications:write", "jobs:moderate", "jobs:read", "jobs:write", "profile:read", "profile:write", "documents:read", "documents:write"
      ])
    )
    error_message = "Document intake must preserve application-only scope admission and the exact JWT scope union."
  }
}

