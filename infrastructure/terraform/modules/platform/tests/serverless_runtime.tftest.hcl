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

run "d2_community_runtime_is_default_dark" {
  command = plan

  assert {
    condition = (
      var.d2_community_runtime.stage == "disabled" &&
      var.d2_community_runtime.ugc_contribution_policy_version == "" &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "UGC_CONTRIBUTION_POLICY_VERSION") &&
      length(aws_apigatewayv2_route.gateway) == 0
    )
    error_message = "The Phase 2 community runtime must add no policy configuration or API route by default."
  }
}

run "d2_gateway_dark_supplies_only_reviewed_policy_and_exact_scopes" {
  command = plan

  variables {
    serverless_runtime_enabled = true
    d2_community_runtime = {
      stage                           = "gateway-dark"
      ugc_contribution_policy_version = "d2-synthetic-policy.v1"
    }
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.UGC_CONTRIBUTION_POLICY_VERSION == "d2-synthetic-policy.v1" &&
      aws_apigatewayv2_route.gateway[0].route_key == "$default" &&
      aws_apigatewayv2_route.gateway[0].authorization_type == "JWT" &&
      toset(aws_apigatewayv2_route.gateway[0].authorization_scopes) == toset([
        "jobs:contribute",
        "jobs:moderate",
        "jobs:read",
        "jobs:write",
        "profile:read",
        "profile:write",
        "trust:appeal:resolve",
        "trust:case:decide",
        "trust:case:open",
        "trust:case:takedown",
        "trust:review"
      ])
    )
    error_message = "Gateway-dark must supply the exact reviewed UGC policy version and bounded Phase 2 JWT scope inventory."
  }
}

run "d2_gateway_dark_rejects_missing_policy_version" {
  command = plan

  variables {
    d2_community_runtime = {
      stage                           = "gateway-dark"
      ugc_contribution_policy_version = ""
    }
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_disabled_stage_rejects_policy_version" {
  command = plan

  variables {
    d2_community_runtime = {
      stage                           = "disabled"
      ugc_contribution_policy_version = "d2-synthetic-policy.v1"
    }
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_gateway_dark_rejects_malformed_policy_version" {
  command = plan

  variables {
    d2_community_runtime = {
      stage                           = "gateway-dark"
      ugc_contribution_policy_version = "LIVE POLICY"
    }
  }

  expect_failures = [var.d2_community_runtime]
}

run "candidate_rights_auth0_secret_preprovisions_with_managed_tags" {
  command = plan

  assert {
    condition = (
      !var.candidate_rights_enabled &&
      length(aws_secretsmanager_secret.candidate_rights_auth0) == 1 &&
      aws_secretsmanager_secret.candidate_rights_auth0[0].tags["ai-job-apply:generated-synthetic-only"] == "true" &&
      aws_secretsmanager_secret.candidate_rights_auth0[0].tags["ai-job-apply:authorized-owner"] == "authorized-operator"
    )
    error_message = "The tagged generated-synthetic Auth0 secret must be provisionable before candidate-rights activation."
  }
}

run "candidate_rights_boundary_accepts_explicit_timing_policy" {
  command = plan

  variables {
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d1-reviewed-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
  }

  assert {
    condition = (
      aws_s3_bucket_versioning.candidate_data_exports[0].versioning_configuration[0].status == "Enabled" &&
      aws_s3_bucket_public_access_block.candidate_data_exports[0].restrict_public_buckets &&
      aws_s3_bucket_lifecycle_configuration.candidate_data_exports[0].rule[0].expiration[0].days == 1 &&
      length(aws_secretsmanager_secret.candidate_rights_auth0) == 1
    )
    error_message = "Candidate exports must be private, versioned, policy-expiring, and paired with an operator-populated managed identity secret."
  }

  assert {
    condition = (
      aws_lambda_function.profile_readiness_activity[0].timeout == 300 &&
      aws_cloudwatch_event_rule.candidate_rights_maintenance[0].state == "ENABLED" &&
      aws_cloudwatch_event_rule.candidate_rights_maintenance[0].schedule_expression == "rate(5 minutes)" &&
      aws_lambda_function.profile_readiness_activity[0].environment[0].variables.CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY == "none" &&
      aws_lambda_function.profile_readiness_activity[0].environment[0].variables.CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS == "900" &&
      aws_lambda_function.gateway[0].environment[0].variables.OIDC_ID_TOKEN_AUDIENCE == "candidate-web-client" &&
      aws_lambda_function.gateway[0].environment[0].variables.CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS == "300" &&
      length(aws_iam_role_policy.candidate_rights_activity) == 1
    )
    error_message = "Only the private activity gets deletion privileges while the gateway receives the exact reviewed policy and bounded download grant."
  }
}

run "candidate_rights_activation_rejects_missing_id_token_audience" {
  command = plan

  variables {
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    candidate_rights_enabled                     = true
    candidate_rights_id_token_audience           = ""
    candidate_rights_policy_version              = "d1-reviewed-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
  }

  expect_failures = [var.candidate_rights_enabled]
}

run "candidate_rights_id_token_audience_rejects_non_runtime_value" {
  command = plan

  variables {
    candidate_rights_id_token_audience = "too-short"
  }

  expect_failures = [var.candidate_rights_id_token_audience]
}

run "candidate_rights_boundary_rejects_short_database_backup_window" {
  command = plan

  variables {
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d1-reviewed-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 35
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
    database_backup_retention_days               = 7
  }

  expect_failures = [var.candidate_rights_enabled]
}

run "candidate_rights_activation_rejects_missing_export_lifetime" {
  command = plan

  variables {
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d1-reviewed-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 300
    candidate_rights_export_lifecycle_days       = 1
  }

  expect_failures = [var.candidate_rights_enabled]
}

run "candidate_rights_activation_rejects_missing_download_grant" {
  command = plan

  variables {
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d1-reviewed-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 300
    candidate_rights_export_lifecycle_days       = 1
  }

  expect_failures = [var.candidate_rights_enabled]
}

run "candidate_rights_activation_rejects_missing_backup_retention" {
  command = plan

  variables {
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d1-reviewed-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_recent_auth_max_age_seconds = 300
    candidate_rights_export_lifecycle_days       = 1
  }

  expect_failures = [var.candidate_rights_enabled]
}

run "candidate_rights_activation_rejects_missing_recent_auth_age" {
  command = plan

  variables {
    private_application_networking           = true
    deploy_document_intake                   = true
    serverless_runtime_enabled               = true
    candidate_rights_enabled                 = true
    candidate_rights_policy_version          = "d1-reviewed-v1"
    candidate_rights_policy_sha256           = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory         = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory  = "none"
    candidate_rights_export_lifetime_seconds = 3600
    candidate_rights_download_grant_seconds  = 300
    candidate_rights_backup_retention_days   = 7
    candidate_rights_export_lifecycle_days   = 1
  }

  expect_failures = [var.candidate_rights_enabled]
}

run "candidate_rights_activation_rejects_missing_export_lifecycle" {
  command = plan

  variables {
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d1-reviewed-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 300
  }

  expect_failures = [var.candidate_rights_enabled]
}

run "candidate_rights_disabled_accepts_unset_timing_policy" {
  command = plan

  variables {
    candidate_rights_auth0_secret_provisioned = false
    candidate_rights_auth0_authorized_owner   = ""
    candidate_rights_id_token_audience        = ""
  }

  assert {
    condition = (
      !var.candidate_rights_enabled &&
      var.candidate_rights_export_lifetime_seconds == null &&
      var.candidate_rights_download_grant_seconds == null &&
      var.candidate_rights_backup_retention_days == null &&
      var.candidate_rights_recent_auth_max_age_seconds == null &&
      var.candidate_rights_export_lifecycle_days == null &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "OIDC_ID_TOKEN_AUDIENCE") &&
      length(aws_s3_bucket.candidate_data_exports) == 0 &&
      length(aws_secretsmanager_secret.candidate_rights_auth0) == 0
    )
    error_message = "Disabled candidate rights must plan with every policy timing unset and no rights resources."
  }
}

run "candidate_rights_recent_auth_rejects_above_runtime_ceiling" {
  command = plan

  variables {
    candidate_rights_recent_auth_max_age_seconds = 901
  }

  expect_failures = [var.candidate_rights_recent_auth_max_age_seconds]
}

run "ingestion_data_plane_deploys_dark_with_ordered_source_gate" {
  command = plan

  variables {
    deploy_ingestion_runtime = true
  }

  assert {
    condition = (
      !var.ingestion_runtime_enabled &&
      !var.ingestion_synthetic_source_enabled &&
      aws_cloudwatch_event_rule.ingestion_schedule[0].state == "DISABLED" &&
      aws_cloudwatch_event_rule.ingestion_terminal[0].state == "DISABLED" &&
      !aws_lambda_event_source_mapping.ingestion_dispatch[0].enabled
    )
    error_message = "A deployed ingestion data plane must remain dark until its ordered runtime and source gates are approved."
  }

  assert {
    condition = (
      aws_sqs_queue.ingestion_dispatch[0].message_retention_seconds == 345600 &&
      aws_sqs_queue.ingestion_dead_letter[0].message_retention_seconds == 1209600 &&
      var.ingestion_retention_days == 30 &&
      aws_cloudwatch_event_target.ingestion_terminal[0].retry_policy[0].maximum_event_age_in_seconds == 3600 &&
      length(aws_lambda_function.ingestion_runtime["coordinator"].dead_letter_config) == 1 &&
      length(aws_lambda_function.ingestion_runtime["terminal"].dead_letter_config) == 1 &&
      length(aws_lambda_function.ingestion_runtime["starter"].dead_letter_config) == 0
    )
    error_message = "Ingestion transport must retain work for four days and every asynchronous failure payload in the DLQ for fourteen days."
  }

  assert {
    condition = (
      length(aws_vpc_endpoint.secretsmanager) == 1 &&
      length(aws_vpc_endpoint.sqs) == 1 &&
      length(aws_vpc_endpoint.lambda) == 1
    )
    error_message = "Every VPC ingestion AWS API call must be admitted only through the exact private endpoint role/action/resource boundary."
  }

  assert {
    condition = (
      contains(keys(aws_lambda_function.ingestion_runtime["starter"].environment[0].variables), "INGESTION_QUEUE_ARN") &&
      length(aws_iam_role.ingestion_runtime) == 4
    )
    error_message = "Ingestion queue, durable reconciliation, and KMS state identities must remain exact."
  }

  assert {
    condition = (
      toset(keys(aws_iam_role.ingestion_runtime)) == toset(["coordinator", "starter", "activity", "terminal"])
    )
    error_message = "Every ingestion transport function requires a separate least-privilege execution role."
  }

  assert {
    condition = (
      jsondecode(aws_cloudwatch_event_rule.ingestion_terminal[0].event_pattern).detail.functionArn == [{ prefix = "${local.ingestion_durable_arn}:" }] &&
      jsondecode(aws_cloudwatch_event_rule.ingestion_terminal[0].event_pattern).detail.status == ["FAILED", "STOPPED", "SUCCEEDED", "TIMED_OUT"]
    )
    error_message = "Terminal reconciliation must retain old version events and authenticate exact persisted function versions in the handler."
  }

  assert {
    condition = (
      length(aws_cloudwatch_metric_alarm.ingestion_runtime_throttles) == 3 &&
      length(aws_cloudwatch_metric_alarm.ingestion_activity_throttles) == 1 &&
      length(aws_cloudwatch_metric_alarm.ingestion_durable_throttles) == 1 &&
      length(aws_cloudwatch_metric_alarm.ingestion_durable_timed_out) == 1 &&
      length(aws_cloudwatch_metric_alarm.ingestion_durable_duration) == 1 &&
      aws_cloudwatch_metric_alarm.ingestion_durable_duration[0].threshold == var.ingestion_execution_timeout_seconds * 900
    )
    error_message = "Ingestion must alarm on every Lambda throttle plus durable timeout and near-timeout duration signals."
  }
}

run "ingestion_source_cannot_bypass_runtime_gate" {
  command = plan
  variables {
    ingestion_synthetic_source_enabled = true
  }
  expect_failures = [var.ingestion_synthetic_source_enabled]
}

run "provider_sources_remain_dark_without_activation_authority" {
  command = plan
  variables {
    deploy_ingestion_runtime = true
    ingestion_provider_sources = [{
      provider                = "greenhouse"
      source_id               = "greenhouse-approved-board"
      enabled                 = false
      tenant                  = "approved_board"
      company_name            = "Approved Company"
      verified_company_domain = "approved.example"
    }]
  }

  assert {
    condition = (
      !var.ingestion_provider_activation_allowed &&
      jsondecode(aws_lambda_function.ingestion_activity[0].environment[0].variables.INGESTION_PROVIDER_SOURCES)[0].enabled == false &&
      length(aws_nat_gateway.this) == 0 &&
      length(aws_nat_gateway.ingestion_provider) == 0 &&
      length(aws_subnet.ingestion_provider) == 2 &&
      length(aws_route_table.ingestion_provider) == 2
    )
    error_message = "Reviewed provider configuration must stay disabled in durable provider-only subnets whose route tables have no public egress without activation authority."
  }
}

run "enabled_provider_requires_explicit_authority_and_private_egress" {
  command = plan
  variables {
    deploy_ingestion_runtime              = true
    ingestion_provider_activation_allowed = false
    ingestion_provider_sources = [{
      provider                = "lever"
      source_id               = "lever-approved-site"
      enabled                 = true
      tenant                  = "approved-site"
      region                  = "eu"
      company_name            = "Approved EU Company"
      verified_company_domain = "eu.approved.example"
    }]
  }
  expect_failures = [terraform_data.ingestion_activation_guard]
}

run "authorized_provider_activation_is_exact_bounded_and_egress_capable" {
  command = plan
  variables {
    deploy_ingestion_runtime              = true
    ingestion_runtime_enabled             = true
    runtime_activation_allowed            = true
    ingestion_provider_activation_allowed = true
    ingestion_provider_private_egress     = true
    ingestion_provider_sources = [{
      provider                = "ashby"
      source_id               = "ashby-approved-board"
      enabled                 = true
      tenant                  = "approved-board"
      company_name            = "Approved Ashby Company"
      verified_company_domain = "ashby.approved.example"
    }]
  }

  assert {
    condition = (
      length(aws_nat_gateway.this) == 0 &&
      length(aws_nat_gateway.ingestion_provider) == 1 &&
      length(aws_subnet.ingestion_provider) == 2 &&
      !var.private_application_networking &&
      aws_cloudwatch_event_rule.ingestion_schedule[0].state == "ENABLED" &&
      jsondecode(aws_lambda_function.ingestion_activity[0].environment[0].variables.INGESTION_PROVIDER_SOURCES)[0].provider == "ashby" &&
      jsondecode(aws_lambda_function.ingestion_activity[0].environment[0].variables.INGESTION_PROVIDER_SOURCES)[0].enabled == true
    )
    error_message = "An authorized provider must receive its exact reviewed configuration in provider-activity-only NAT subnets without adding shared-private egress."
  }
}

run "provider_egress_cannot_exist_without_exact_activation" {
  command = plan
  variables {
    deploy_ingestion_runtime          = true
    ingestion_provider_private_egress = true
  }
  expect_failures = [terraform_data.ingestion_activation_guard]
}

run "ingestion_runtime_requires_global_activation_authority" {
  command = plan
  variables {
    deploy_ingestion_runtime   = true
    ingestion_runtime_enabled  = true
    runtime_activation_allowed = false
  }
  expect_failures = [var.ingestion_runtime_enabled]
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
        "jobs:moderate", "jobs:read", "jobs:write", "profile:read", "profile:write"
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
        "documents:read", "documents:write", "jobs:moderate", "jobs:read", "jobs:write", "profile:read", "profile:write"
      ]) &&
      contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "DOCUMENT_UPLOAD_BUCKET") &&
      contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "DOCUMENT_UPLOAD_KMS_KEY_ARN")
    )
    error_message = "The exact quarantine prefix must be scanned and exposed only to the upload-grant issuer."
  }
}

run "document_processing_is_isolated_scale_to_zero_and_dark_first" {
  command = plan

  variables {
    deploy_document_intake                        = true
    document_processing_deployment_stage          = "complete-dark"
    document_parser_invocation_qualified_arn      = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-staging-document-parser:1"
    document_scan_mapping_enabled                 = false
    document_scan_event_rule_enabled              = false
    document_security_health_rules_enabled        = true
    serverless_runtime_enabled                    = true
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

  assert {
    condition = (
      length(aws_lambda_function.document_processor) == 1 &&
      length(aws_lambda_function.document_parser) == 1 &&
      aws_lambda_function.document_processor[0].reserved_concurrent_executions == 2 &&
      aws_lambda_function.document_parser[0].reserved_concurrent_executions == 2 &&
      aws_lambda_function.document_parser[0].timeout == 45 &&
      length(aws_lambda_function.document_parser[0].logging_config) == 0 &&
      length(aws_lambda_function.document_parser[0].tracing_config) == 0 &&
      length(aws_lambda_function.document_parser[0].vpc_config[0].security_group_ids) == 1 &&
      length(aws_lambda_function.document_processor[0].vpc_config[0].security_group_ids) == 1 &&
      aws_security_group.document_parser[0].description == "No database or internet egress; exact DNS and S3 gateway only"
    )
    error_message = "Raw parsing must use its own no-database security group and both functions require hard concurrency ceilings."
  }

  assert {
    condition = (
      !aws_lambda_event_source_mapping.document_scan_results[0].enabled &&
      aws_cloudwatch_event_rule.document_scan_results[0].state == "DISABLED" &&
      aws_cloudwatch_event_rule.document_scan_tag_failure[0].state == "ENABLED" &&
      aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0].state == "ENABLED" &&
      aws_cloudwatch_event_rule.document_processing_reconciler[0].state == "DISABLED" &&
      aws_lambda_event_source_mapping.document_scan_results[0].batch_size == 1 &&
      aws_sqs_queue.document_scan_results[0].visibility_timeout_seconds == 360 &&
      aws_sqs_queue.document_scan_dead_letter[0].message_retention_seconds == 1209600 &&
      aws_sqs_queue.document_scan_delivery_dead_letter[0].message_retention_seconds == 1209600 &&
      length(aws_cloudwatch_metric_alarm.document_scan_delivery_dead_letter) == 1 &&
      length(aws_cloudwatch_metric_alarm.document_processing_timed_out) == 1
    )
    error_message = "The processing boundary must deploy dark with one-record partial-batch processing and a retained DLQ."
  }

  assert {
    condition = (
      contains(keys(aws_lambda_function.document_processor[0].environment[0].variables), "DOCUMENT_PARSER_FUNCTION_ARN") &&
      contains(keys(aws_lambda_function.document_processor[0].environment[0].variables), "DOCUMENT_OBJECT_ACCESS_ROLE_ARN") &&
      aws_lambda_function.document_parser[0].environment[0].variables.DOCUMENT_PARSER_VERSION == "resume-parser-v1" &&
      length(aws_iam_role.document_parser_object_access) == 1 &&
      aws_vpc_endpoint.candidate_documents_s3[0].vpc_endpoint_type == "Gateway" &&
      aws_vpc_endpoint.sts[0].vpc_endpoint_type == "Interface" &&
      aws_vpc_endpoint.sts[0].private_dns_enabled
    )
    error_message = "The coordinator must mint exact object sessions through private STS and invoke an immutable parser through the S3 gateway boundary."
  }
}

run "document_event_rule_requires_mapping_first" {
  command = plan

  variables {
    document_scan_event_rule_enabled = true
  }

  expect_failures = [var.document_scan_event_rule_enabled]
}

run "document_processing_rejects_unknown_stage" {
  command = plan

  variables {
    document_processing_deployment_stage = "partial"
  }

  expect_failures = [var.document_processing_deployment_stage]
}

run "kms_prerequisite_does_not_create_document_runtime" {
  command = plan

  variables {
    document_processing_deployment_stage = "kms-prerequisite"
  }

  assert {
    condition = (
      length(aws_lambda_function.document_parser) == 0 &&
      length(aws_lambda_function.document_processor) == 0 &&
      length(aws_sqs_queue.document_scan_results) == 0
    )
    error_message = "The KMS prerequisite may add only document EventBridge grants, never runtime resources."
  }
}

run "parser_dark_rejects_a_premature_parser_invocation_pin" {
  command = plan

  variables {
    deploy_document_intake                     = true
    document_processing_deployment_stage       = "parser-dark"
    document_parser_invocation_qualified_arn   = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-staging-document-parser:1"
    document_parser_artifact_s3_key            = "lambda/documents/parser.zip"
    document_parser_artifact_s3_object_version = "parser-version"
    document_parser_artifact_sha256            = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    document_parser_artifact_base64sha256      = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
    document_security_health_rules_enabled     = true
  }

  expect_failures = [var.document_parser_invocation_qualified_arn]
}

run "parser_dark_does_not_create_coordinator_runtime" {
  command = plan

  variables {
    deploy_document_intake                     = true
    document_processing_deployment_stage       = "parser-dark"
    document_parser_artifact_s3_key            = "lambda/documents/parser.zip"
    document_parser_artifact_s3_object_version = "parser-version"
    document_parser_artifact_sha256            = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    document_parser_artifact_base64sha256      = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
    document_security_health_rules_enabled     = true
  }

  assert {
    condition = (
      length(aws_lambda_function.document_parser) == 1 &&
      length(aws_lambda_function.document_processor) == 0 &&
      length(aws_lambda_event_source_mapping.document_scan_results) == 0 &&
      length(aws_vpc_endpoint.sts) == 0 &&
      length(aws_cloudwatch_event_target.document_processing_reconciler) == 0 &&
      aws_cloudwatch_event_rule.document_scan_results[0].state == "DISABLED" &&
      aws_cloudwatch_event_rule.document_processing_reconciler[0].state == "DISABLED" &&
      aws_cloudwatch_event_rule.document_scan_tag_failure[0].state == "ENABLED" &&
      aws_cloudwatch_event_rule.document_scan_plan_unhealthy[0].state == "ENABLED"
    )
    error_message = "Parser-dark must not create any invokable coordinator runtime or coordinator service endpoint."
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

run "public_job_reader_dark_deploy_has_no_anonymous_route" {
  command = plan

  variables {
    deploy_public_job_reader                         = true
    public_job_route_activation_allowed              = true
    public_job_database_boundary_version             = "0013_public_job_sitemap"
    public_job_lambda_artifact_s3_key                = "lambda/public-jobs/reader.zip"
    public_job_lambda_artifact_s3_object_version     = "public-reader-version"
    public_job_lambda_artifact_sha256                = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    public_job_lambda_artifact_base64sha256          = "ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU="
    public_job_projection_artifact_s3_key            = "lambda/public-jobs/projection.zip"
    public_job_projection_artifact_s3_object_version = "public-projection-version"
    public_job_projection_artifact_sha256            = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    public_job_projection_artifact_base64sha256      = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
    serverless_runtime_enabled                       = false
  }

  assert {
    condition = (
      length(aws_lambda_function.public_job) == 1 &&
      length(aws_lambda_function.public_job_projection) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_projection_errors) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_projection_throttles) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_projection_duration) == 1 &&
      length(aws_apigatewayv2_route.public_job) == 0 &&
      length(aws_lambda_permission.public_job_api) == 0
    )
    error_message = "A dark public reader must have no anonymous route or API invocation grant."
  }

  assert {
    condition = (
      aws_lambda_function.public_job[0].reserved_concurrent_executions == 1 &&
      toset(keys(aws_lambda_function.public_job[0].environment[0].variables)) == toset([
        "LOG_LEVEL",
        "NODE_ENV",
        "PUBLIC_JOB_CACHE_CAPACITY",
        "PUBLIC_JOB_CACHE_TTL_MS",
        "PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS",
        "PUBLIC_JOB_PROJECTION_ARN",
        "RELEASE_SHA"
      ]) &&
      aws_lambda_function.public_job[0].environment[0].variables.PUBLIC_JOB_CACHE_CAPACITY == "128" &&
      aws_lambda_function.public_job[0].environment[0].variables.PUBLIC_JOB_PROJECTION_ARN == "${local.public_job_projection_function_arn}:${var.environment}" &&
      aws_lambda_function.public_job[0].s3_key == "lambda/public-jobs/reader.zip" &&
      length(aws_lambda_function.public_job[0].vpc_config) == 0 &&
      aws_lambda_function.public_job_projection[0].handler == "index.projectionHandler" &&
      aws_lambda_function.public_job_projection[0].s3_key == "lambda/public-jobs/projection.zip" &&
      aws_lambda_function.public_job_projection[0].environment[0].variables.PUBLIC_JOB_DATABASE_USER == "ai_job_apply_public_job_reader" &&
      length(aws_lambda_function.public_job_projection[0].vpc_config) == 1 &&
      aws_db_instance.postgres[0].iam_database_authentication_enabled
    )
    error_message = "The anonymous edge must have no VPC/database identity and may call only the private one-connection projection."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.public_job_lambda_vpc_guard[0].policy).Statement[0].Effect == "Deny" &&
      toset(jsondecode(aws_iam_role_policy.public_job_lambda_vpc_guard[0].policy).Statement[0].Action) == toset([
        "ec2:AssignPrivateIpAddresses",
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DescribeSubnets",
        "ec2:DetachNetworkInterface",
        "ec2:UnassignPrivateIpAddresses"
      ]) &&
      jsondecode(aws_iam_role_policy.public_job_lambda_vpc_guard[0].policy).Statement[0].Condition.ArnEquals["lambda:SourceFunctionArn"] == local.public_job_projection_function_arn
    )
    error_message = "Public-reader code must be denied the VPC-management permissions retained for the Lambda service."
  }

  assert {
    condition = (
      one([
        for statement in data.aws_iam_policy_document.public_job_lambda[0].statement : statement
        if statement.sid == "DecryptLambdaEnvironmentAtColdStart"
      ]).effect == "Allow" &&
      toset(one([
        for statement in data.aws_iam_policy_document.public_job_lambda[0].statement : statement
        if statement.sid == "DecryptLambdaEnvironmentAtColdStart"
      ]).actions) == toset(["kms:Decrypt"]) &&
      length(one([
        for statement in data.aws_iam_policy_document.public_job_lambda[0].statement : statement
        if statement.sid == "DecryptLambdaEnvironmentAtColdStart"
      ]).resources) == 1 &&
      one(data.aws_iam_policy_document.public_job_lambda_kms_code_guard[0].statement).sid == "DenyFunctionCodeEnvironmentDecrypt" &&
      one(data.aws_iam_policy_document.public_job_lambda_kms_code_guard[0].statement).effect == "Deny" &&
      toset(one(data.aws_iam_policy_document.public_job_lambda_kms_code_guard[0].statement).actions) == toset(["kms:Decrypt"]) &&
      length(one(data.aws_iam_policy_document.public_job_lambda_kms_code_guard[0].statement).resources) == 1 &&
      one(one(data.aws_iam_policy_document.public_job_lambda_kms_code_guard[0].statement).condition).test == "ArnEquals" &&
      one(one(data.aws_iam_policy_document.public_job_lambda_kms_code_guard[0].statement).condition).variable == "lambda:SourceFunctionArn" &&
      toset(one(one(data.aws_iam_policy_document.public_job_lambda_kms_code_guard[0].statement).condition).values) == toset([local.public_job_projection_function_arn]) &&
      toset(one([
        for statement in data.aws_iam_policy_document.public_job_edge[0].statement : statement
        if statement.sid == "InvokeExactPublicProjection"
      ]).resources) == toset(["${local.public_job_projection_function_arn}:${var.environment}"]) &&
      length([
        for statement in data.aws_iam_policy_document.public_job_edge[0].statement : statement
        if contains(statement.actions, "rds-db:connect") || contains(statement.actions, "ec2:CreateNetworkInterface")
      ]) == 0
    )
    error_message = "Lambda service cold starts may decrypt the exact CMK environment while public-reader function code is explicitly denied KMS decryption."
  }

}

run "public_job_reader_activation_is_exact_and_bounded" {
  command = plan

  variables {
    deploy_public_job_reader                         = true
    public_job_route_activation_allowed              = true
    public_job_database_boundary_version             = "0013_public_job_sitemap"
    public_job_lambda_artifact_s3_key                = "lambda/public-jobs/reader.zip"
    public_job_lambda_artifact_s3_object_version     = "public-reader-version"
    public_job_lambda_artifact_sha256                = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    public_job_lambda_artifact_base64sha256          = "ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU="
    public_job_projection_artifact_s3_key            = "lambda/public-jobs/projection.zip"
    public_job_projection_artifact_s3_object_version = "public-projection-version"
    public_job_projection_artifact_sha256            = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    public_job_projection_artifact_base64sha256      = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
    serverless_runtime_enabled                       = true
  }

  assert {
    condition = (
      length(aws_apigatewayv2_route.public_job) == 1 &&
      aws_apigatewayv2_route.public_job[0].route_key == "GET /v1/public/jobs/{jobId}" &&
      aws_apigatewayv2_route.public_job[0].authorization_type == "NONE" &&
      length(aws_apigatewayv2_route.public_job_sitemap) == 1 &&
      aws_apigatewayv2_route.public_job_sitemap[0].route_key == "GET /v1/public/jobs/sitemap" &&
      aws_apigatewayv2_route.public_job_sitemap[0].authorization_type == "NONE" &&
      length(aws_lambda_permission.public_job_api) == 1
    )
    error_message = "Only the exact anonymous detail and sitemap GET routes may activate with the complete runtime gate."
  }

  assert {
    condition = (
      var.public_job_route_throttling_rate_limit == 1 &&
      var.public_job_route_throttling_burst_limit == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_route_4xx) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_route_5xx) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_sitemap_route_4xx) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_sitemap_route_5xx) == 1
    )
    error_message = "Both public route budgets must match concurrency and expose edge 4xx/5xx alarms."
  }
}

run "public_job_reader_route_uses_the_remediated_edge_projection_boundary" {
  command = plan

  variables {
    deploy_public_job_reader                         = true
    public_job_cluster_residual_accepted             = false
    public_job_route_activation_allowed              = true
    public_job_database_boundary_version             = "0013_public_job_sitemap"
    public_job_lambda_artifact_s3_key                = "lambda/public-jobs/reader.zip"
    public_job_lambda_artifact_s3_object_version     = "public-reader-version"
    public_job_lambda_artifact_sha256                = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    public_job_lambda_artifact_base64sha256          = "ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU="
    public_job_projection_artifact_s3_key            = "lambda/public-jobs/projection.zip"
    public_job_projection_artifact_s3_object_version = "public-projection-version"
    public_job_projection_artifact_sha256            = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    public_job_projection_artifact_base64sha256      = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
    serverless_runtime_enabled                       = true
    runtime_activation_allowed                       = true
  }

  assert {
    condition = (
      length(aws_lambda_function.public_job) == 1 &&
      length(aws_lambda_function.public_job_projection) == 1 &&
      length(aws_apigatewayv2_route.public_job) == 1 &&
      length(aws_lambda_permission.public_job_api) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_route_4xx) == 1 &&
      length(aws_cloudwatch_metric_alarm.public_job_route_5xx) == 1 &&
      length(aws_lambda_function.public_job[0].vpc_config) == 0 &&
      length(aws_lambda_function.public_job_projection[0].vpc_config) == 1
    )
    error_message = "The route may activate only through the no-VPC edge and private fixed-query projection boundary."
  }
}

run "public_job_reader_rejects_a_larger_edge_burst" {
  command = plan

  variables {
    public_job_route_throttling_burst_limit = 2
  }

  expect_failures = [var.public_job_route_throttling_burst_limit]
}

run "public_job_reader_rejects_a_larger_edge_rate" {
  command = plan

  variables {
    public_job_route_throttling_rate_limit = 2
  }

  expect_failures = [var.public_job_route_throttling_rate_limit]
}

run "public_job_reader_requires_the_exact_database_boundary" {
  command = plan

  variables {
    deploy_public_job_reader                         = true
    public_job_lambda_artifact_s3_key                = "lambda/public-jobs/reader.zip"
    public_job_lambda_artifact_s3_object_version     = "public-reader-version"
    public_job_lambda_artifact_sha256                = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    public_job_lambda_artifact_base64sha256          = "ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU="
    public_job_projection_artifact_s3_key            = "lambda/public-jobs/projection.zip"
    public_job_projection_artifact_s3_object_version = "public-projection-version"
    public_job_projection_artifact_sha256            = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    public_job_projection_artifact_base64sha256      = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
  }

  expect_failures = [var.deploy_public_job_reader]
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

run "migration_task_has_private_image_and_log_paths" {
  command = plan

  variables {
    migration_image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }

  assert {
    condition = (
      length(aws_vpc_endpoint.migration_ecr_api) == 1 &&
      length(aws_vpc_endpoint.migration_ecr_dkr) == 1 &&
      length(aws_vpc_endpoint.migration_logs) == 1 &&
      aws_vpc_endpoint.migration_ecr_api[0].private_dns_enabled &&
      aws_vpc_endpoint.migration_ecr_dkr[0].private_dns_enabled &&
      aws_vpc_endpoint.migration_logs[0].private_dns_enabled
    )
    error_message = "A private Fargate migration task requires private DNS endpoints for both ECR surfaces and CloudWatch Logs."
  }

  assert {
    condition = (
      length(aws_vpc_endpoint.migration_s3) == 1 &&
      aws_vpc_endpoint.migration_s3[0].vpc_endpoint_type == "Gateway" &&
      length(aws_vpc_endpoint.migration_s3[0].route_table_ids) == 1
    )
    error_message = "The no-public-IP migration task requires an S3 gateway path on its exact route table for regional ECR layers."
  }

  assert {
    condition = (
      length(aws_security_group.migration_aws_endpoints) == 1 &&
      length(aws_security_group.migration_aws_endpoints[0].ingress) == 1 &&
      one(aws_security_group.migration_aws_endpoints[0].ingress).from_port == 443 &&
      one(aws_security_group.migration_aws_endpoints[0].ingress).to_port == 443 &&
      length(one(aws_security_group.migration_aws_endpoints[0].ingress).security_groups) == 1
    )
    error_message = "Migration AWS interface endpoints must admit only TLS from the application security group."
  }
}
