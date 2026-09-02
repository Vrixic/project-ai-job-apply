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
    defaults = { arn = "arn:aws:iam::111122223333:policy/ai-job-apply-staging-workload-boundary" }
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

  oidc_issuer                               = "https://identity.example.test/"
  oidc_audience                             = "https://api.example.test"
  deploy_applications                       = true
  deploy_gateway_lambda                     = true
  gateway_lambda_artifact_s3_key            = "lambda/gateway.zip"
  gateway_lambda_artifact_s3_object_version = "gateway-version"
  gateway_lambda_artifact_sha256            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  gateway_lambda_artifact_base64sha256      = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
  gateway_lambda_extension_layer_arn        = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
}

run "d2_defaults_create_nothing" {
  command = plan

  assert {
    condition = (
      !var.d2_community_runtime.deploy &&
      !var.d2_community_runtime.enabled &&
      length(aws_lambda_function.d2_community_scheduled) == 0 &&
      length(aws_lambda_function.d2_trust_signal) == 0 &&
      length(aws_sqs_queue.d2_trust_signal) == 0 &&
      length(aws_sqs_queue.d2_trust_signal_dead_letter) == 0 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 0 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 0 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 0 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 0 &&
      length(aws_nat_gateway.this) == 0
    )
    error_message = "Default Phase 2 composition must create no D2 compute, queues, schedules, mappings, routes, or NAT."
  }
}

run "d2_dark_deploy_has_immutable_compute_queues_and_alarms_without_triggers" {
  command = plan

  variables {
    d2_community_runtime = {
      deploy                                         = true
      enabled                                        = false
      artifact_s3_key                                = "lambda/d2/community.zip"
      artifact_s3_object_version                     = "d2-community-version"
      artifact_sha256                                = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      artifact_base64sha256                          = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI="
      lambda_extension_layer_arn                     = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
      scheduled_reserved_concurrency                 = 1
      signal_reserved_concurrency                    = 1
      lambda_timeout_seconds                         = 60
      queue_visibility_timeout_seconds               = 120
      queue_message_retention_seconds                = 86400
      dead_letter_retention_seconds                  = 1209600
      queue_max_receive_count                        = 3
      schedule_expression                            = ""
      processing_policy_version                      = ""
      processing_worker_id                           = ""
      processing_batch_limit                         = 0
      processing_max_attempts                        = 0
      processing_claim_lease_milliseconds            = 0
      processing_retry_delay_milliseconds            = []
      contribution_delivery_worker_id                = ""
      contribution_delivery_batch_limit              = 0
      contribution_delivery_max_attempts             = 0
      contribution_delivery_claim_lease_milliseconds = 0
      contribution_delivery_retry_delay_milliseconds = []
      trust_delivery_worker_id                       = ""
      trust_delivery_batch_limit                     = 0
      trust_delivery_max_attempts                    = 0
      trust_delivery_claim_lease_milliseconds        = 0
      trust_delivery_retry_delay_milliseconds        = []
      trust_signal_batch_size                        = 0
      ugc_contribution_policy_version                = ""
      signed_policy_json                             = ""
      signed_public_keys_json                        = ""
      trust_reviewer_assignments_json                = ""
      trust_evidence_allowlist_json                  = ""
      trust_policy_version                           = ""
      trust_appeal_window_milliseconds               = 0
      trust_system_actor_id                          = ""
      route_throttling_rate_limit                    = 0
      route_throttling_burst_limit                   = 0
      lambda_error_alarm_threshold                   = 0
      lambda_throttle_alarm_threshold                = 0
      lambda_duration_alarm_threshold_milliseconds   = 45000
      queue_age_alarm_threshold_seconds              = 300
      dead_letter_alarm_threshold                    = 0
      release_authority                              = ""
    }
  }

  assert {
    condition = (
      length(aws_lambda_function.d2_community_scheduled) == 1 &&
      length(aws_lambda_function.d2_trust_signal) == 1 &&
      aws_lambda_function.d2_community_scheduled[0].publish &&
      aws_lambda_function.d2_trust_signal[0].publish &&
      length(aws_lambda_alias.d2_community_scheduled) == 1 &&
      length(aws_lambda_alias.d2_trust_signal) == 1 &&
      length(aws_sqs_queue.d2_trust_signal) == 1 &&
      length(aws_sqs_queue.d2_trust_signal_dead_letter) == 1 &&
      length(aws_cloudwatch_metric_alarm.d2_community_lambda_errors) == 2 &&
      length(aws_cloudwatch_metric_alarm.d2_community_lambda_throttles) == 2 &&
      length(aws_cloudwatch_metric_alarm.d2_community_lambda_duration) == 2 &&
      length(aws_cloudwatch_metric_alarm.d2_trust_signal_queue_age) == 1 &&
      length(aws_cloudwatch_metric_alarm.d2_trust_signal_dead_letter) == 1 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 0 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 0 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 0 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 0 &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "false" &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_CONTRIBUTION_ROUTES_ENABLED") &&
      length(aws_nat_gateway.this) == 0
    )
    error_message = "Dark deployment must create only immutable compute, exact queues, IAM, and alarms; triggers and routes must remain structurally absent."
  }
}

run "d2_activation_requires_and_wires_every_explicit_boundary" {
  command = plan

  variables {
    d2_community_runtime = {
      deploy                                         = true
      enabled                                        = true
      artifact_s3_key                                = "lambda/d2/community.zip"
      artifact_s3_object_version                     = "d2-community-version"
      artifact_sha256                                = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      artifact_base64sha256                          = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI="
      lambda_extension_layer_arn                     = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
      scheduled_reserved_concurrency                 = 1
      signal_reserved_concurrency                    = 1
      lambda_timeout_seconds                         = 60
      queue_visibility_timeout_seconds               = 120
      queue_message_retention_seconds                = 86400
      dead_letter_retention_seconds                  = 1209600
      queue_max_receive_count                        = 3
      schedule_expression                            = "rate(5 minutes)"
      processing_policy_version                      = "d2-synthetic-processing.v1"
      processing_worker_id                           = "d2:processing"
      processing_batch_limit                         = 5
      processing_max_attempts                        = 3
      processing_claim_lease_milliseconds            = 60000
      processing_retry_delay_milliseconds            = [1000, 5000]
      contribution_delivery_worker_id                = "d2:contribution-delivery"
      contribution_delivery_batch_limit              = 5
      contribution_delivery_max_attempts             = 3
      contribution_delivery_claim_lease_milliseconds = 60000
      contribution_delivery_retry_delay_milliseconds = [1000, 5000]
      trust_delivery_worker_id                       = "d2:trust-delivery"
      trust_delivery_batch_limit                     = 5
      trust_delivery_max_attempts                    = 3
      trust_delivery_claim_lease_milliseconds        = 60000
      trust_delivery_retry_delay_milliseconds        = [1000, 5000]
      trust_signal_batch_size                        = 5
      ugc_contribution_policy_version                = "d2-synthetic-consent.v1"
      signed_policy_json                             = "{\"synthetic\":true}"
      signed_public_keys_json                        = "{\"synthetic-key\":\"public\"}"
      trust_reviewer_assignments_json                = "[{\"issuer\":\"https://identity.example.test/\",\"subject\":\"auth0|synthetic\",\"roles\":[\"case_reader\"],\"verifiedRequesterTakedown\":false}]"
      trust_evidence_allowlist_json                  = "[]"
      trust_policy_version                           = "d2-synthetic-trust.v1"
      trust_appeal_window_milliseconds               = 86400000
      trust_system_actor_id                          = "019d04cf-1f80-7000-8000-000000000099"
      route_throttling_rate_limit                    = 5
      route_throttling_burst_limit                   = 5
      lambda_error_alarm_threshold                   = 0
      lambda_throttle_alarm_threshold                = 0
      lambda_duration_alarm_threshold_milliseconds   = 45000
      queue_age_alarm_threshold_seconds              = 300
      dead_letter_alarm_threshold                    = 0
      release_authority                              = "synthetic-release-authority"
    }
  }

  assert {
    condition = (
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 1 &&
      aws_cloudwatch_event_rule.d2_community_schedule[0].schedule_expression == "rate(5 minutes)" &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 1 &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].batch_size == 5 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 15 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 1 &&
      aws_apigatewayv2_route.d2_contribution_policy[0].authorization_type == "NONE" &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/jobs/contributions"].authorization_scopes) == toset(["jobs:contribute"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/admin/trust/cases"].authorization_scopes) == toset(["trust:review", "trust:case:open"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["GET /v1/saved-job-captures/{captureId}"].authorization_scopes) == toset(["jobs:read"]) &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON == "{\"synthetic\":true}"
    )
    error_message = "Activation must bind the exact schedule, batch, policy, Trust, and separately scoped API routes."
  }
}
