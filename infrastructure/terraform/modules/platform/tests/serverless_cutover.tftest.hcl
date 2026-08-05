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
}

mock_provider "random" {}
mock_provider "time" {}

run "cutover_couples_api_dispatch_and_workflow_triggers" {
  command = plan

  variables {
    name        = "ai-job-apply"
    environment = "staging"
    vpc_cidr    = "10.30.0.0/16"

    gateway_image                             = "example.invalid/gateway@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    worker_image                              = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    oidc_issuer                               = "https://example.auth0.com/"
    oidc_audience                             = "https://api.example.invalid"
    temporal_address                          = "example.tmprl.cloud:7233"
    temporal_namespace                        = "example.tmprl.cloud"
    deploy_applications                       = true
    run_continuous_ecs_runtime                = false
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
    serverless_runtime_cutover                            = true
  }

  assert {
    condition = (
      length(aws_apigatewayv2_integration.gateway) == 1 &&
      length(aws_apigatewayv2_integration.gateway_lambda) == 1 &&
      aws_apigatewayv2_integration.gateway_lambda[0].integration_type == "AWS_PROXY" &&
      aws_apigatewayv2_integration.gateway_lambda[0].payload_format_version == "2.0"
    )
    error_message = "Cutover must retain the ECS integration for rollback and add one Lambda proxy integration."
  }

  assert {
    condition = (
      aws_apigatewayv2_route.gateway[0].authorization_type == "JWT" &&
      length(aws_apigatewayv2_route.gateway_lambda_public) == 2 &&
      alltrue([for route in aws_apigatewayv2_route.gateway_lambda_public : route.authorization_type == "NONE"])
    )
    error_message = "Cutover must protect the default route while keeping only the two health routes public."
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.OUTBOX_DISPATCH_TARGET == "lambda_durable" &&
      aws_lambda_event_source_mapping.outbox_starter[0].enabled &&
      aws_cloudwatch_event_rule.outbox_reconciler[0].state == "ENABLED" &&
      aws_cloudwatch_event_rule.profile_readiness_terminal[0].state == "ENABLED"
    )
    error_message = "API routing, new-event dispatch, and all workflow triggers must cut over together."
  }

  assert {
    condition = (
      aws_ecs_service.gateway[0].desired_count == 0 &&
      aws_ecs_service.worker[0].desired_count == 0
    )
    error_message = "Serverless cutover must preserve the retained ECS rollback services at zero tasks."
  }
}
