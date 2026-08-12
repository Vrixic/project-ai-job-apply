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
}

run "enabled_runtime_couples_api_dispatch_and_workflow_triggers" {
  command = plan

  variables {
    serverless_runtime_enabled = true
  }

  assert {
    condition = (
      length(aws_apigatewayv2_integration.gateway_lambda) == 1 &&
      aws_apigatewayv2_integration.gateway_lambda[0].integration_type == "AWS_PROXY" &&
      aws_apigatewayv2_integration.gateway_lambda[0].payload_format_version == "2.0"
    )
    error_message = "The active API must use exactly one Lambda proxy integration."
  }

  assert {
    condition = (
      length(aws_apigatewayv2_route.gateway) == 1 &&
      aws_apigatewayv2_route.gateway[0].authorization_type == "JWT" &&
      toset(aws_apigatewayv2_route.gateway[0].authorization_scopes) == toset([
        "jobs:read", "profile:read", "profile:write"
      ]) &&
      length(aws_apigatewayv2_route.gateway_lambda_public) == 2 &&
      alltrue([for route in aws_apigatewayv2_route.gateway_lambda_public : route.authorization_type == "NONE"])
    )
    error_message = "The default route must require JWT while only the two health routes remain public."
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.OUTBOX_DISPATCH_TARGET == "lambda_durable" &&
      aws_lambda_event_source_mapping.outbox_starter[0].enabled &&
      aws_cloudwatch_event_rule.outbox_reconciler[0].state == "ENABLED" &&
      aws_cloudwatch_event_rule.profile_readiness_terminal[0].state == "ENABLED"
    )
    error_message = "API dispatch and all durable-workflow triggers must activate together."
  }

  assert {
    condition = (
      aws_cloudwatch_event_rule.profile_readiness_terminal[0].name ==
      local.profile_readiness_terminal_rule_name &&
      aws_lambda_permission.profile_readiness_terminal[0].source_arn ==
      local.profile_readiness_terminal_rule_arn
    )
    error_message = "Terminal recovery must retain one stable exact-rule ARN."
  }
}

run "document_intake_is_private_encrypted_and_malware_scanned" {
  command = plan

  variables {
    deploy_document_intake                  = true
    candidate_document_cors_allowed_origins = ["http://localhost:3000"]
    serverless_runtime_enabled              = true
  }

  assert {
    condition = (
      length(aws_s3_bucket.candidate_documents) == 1 &&
      aws_s3_bucket.candidate_documents[0].bucket == "ai-job-apply-staging-candidate-docs-111122223333" &&
      aws_s3_bucket_versioning.candidate_documents[0].versioning_configuration[0].status == "Enabled" &&
      aws_s3_bucket_public_access_block.candidate_documents[0].block_public_acls &&
      aws_s3_bucket_public_access_block.candidate_documents[0].block_public_policy &&
      aws_s3_bucket_public_access_block.candidate_documents[0].restrict_public_buckets
    )
    error_message = "Candidate documents require a dedicated versioned bucket with every public access path blocked."
  }

  assert {
    condition = (
      aws_guardduty_malware_protection_plan.candidate_documents[0].protected_resource[0].s3_bucket[0].object_prefixes == toset(["quarantine/"]) &&
      aws_guardduty_malware_protection_plan.candidate_documents[0].actions[0].tagging[0].status == "ENABLED" &&
      toset(aws_apigatewayv2_route.gateway[0].authorization_scopes) == toset([
        "documents:read", "documents:write", "jobs:read", "profile:read", "profile:write"
      ]) &&
      contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "DOCUMENT_UPLOAD_BUCKET") &&
      contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "DOCUMENT_UPLOAD_KMS_KEY_ARN")
    )
    error_message = "The exact quarantine prefix must be scanned and exposed only to the upload-grant issuer."
  }
}

run "disabled_runtime_is_dark_without_a_legacy_provider" {
  command = plan

  variables {
    serverless_runtime_enabled = false
  }

  assert {
    condition = (
      length(aws_apigatewayv2_integration.gateway_lambda) == 1 &&
      length(aws_apigatewayv2_route.gateway) == 0 &&
      length(aws_apigatewayv2_route.gateway_lambda_public) == 0
    )
    error_message = "Disabling the runtime must remove public routes while retaining versioned Lambda resources for reviewed recovery."
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.OUTBOX_DISPATCH_TARGET == "lambda_durable" &&
      !aws_lambda_event_source_mapping.outbox_starter[0].enabled &&
      aws_cloudwatch_event_rule.outbox_reconciler[0].state == "DISABLED" &&
      aws_cloudwatch_event_rule.profile_readiness_terminal[0].state == "DISABLED"
    )
    error_message = "Dark recovery must disable every trigger without restoring a retired provider."
  }
}

run "dormant_data_plane_removes_idle_cost_drivers" {
  command = plan

  variables {
    serverless_runtime_enabled          = false
    persistent_data_plane_enabled       = false
    database_deletion_protection        = false
    retain_database_snapshot_on_destroy = false
  }

  assert {
    condition = (
      length(aws_db_instance.postgres) == 0 &&
      length(aws_secretsmanager_secret_version.database_url) == 0 &&
      length(aws_vpc_endpoint.secretsmanager) == 0 &&
      length(aws_vpc_endpoint.sqs) == 0 &&
      length(aws_vpc_endpoint.lambda) == 0
    )
    error_message = "Dormant mode must remove RDS, its generated connection value, and every hourly interface endpoint."
  }

  assert {
    condition = (
      length(aws_lambda_function.gateway) == 1 &&
      aws_s3_bucket.artifacts.bucket_prefix == "ai-job-apply-staging-artifacts-" &&
      aws_ecr_repository.migration.name == "ai-job-apply/migration" &&
      aws_kms_key.platform.enable_key_rotation
    )
    error_message = "Dormant mode must retain the inexpensive immutable artifacts and control plane needed for reproducible activation."
  }
}

run "dormancy_requires_prior_database_unprotection" {
  command = plan

  variables {
    serverless_runtime_enabled    = false
    persistent_data_plane_enabled = false
    database_deletion_protection  = true
  }

  expect_failures = [aws_kms_key.platform]
}

run "environment_lifecycle_can_reject_runtime_activation" {
  command = plan

  variables {
    serverless_runtime_enabled = true
    runtime_activation_allowed = false
  }

  expect_failures = [aws_kms_key.platform]
}

run "migration_repository_is_dedicated_and_hardened" {
  command = plan

  assert {
    condition = (
      aws_ecr_repository.migration.name == "ai-job-apply/migration" &&
      aws_ecr_repository.migration.image_tag_mutability == "IMMUTABLE" &&
      aws_ecr_repository.migration.image_scanning_configuration[0].scan_on_push &&
      aws_ecr_repository.migration.encryption_configuration[0].encryption_type == "KMS"
    )
    error_message = "Database migrations require one dedicated immutable, scanned, KMS-encrypted repository."
  }
}
