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
  mock_resource "aws_cloudformation_stack" {
    defaults = {
      outputs = {
        DurableAliasArn   = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:staging"
        DurableVersionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:1"
      }
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

  # Test-only reusable active input; it is not a platform-module variable or deployment default.
  d2_active_runtime_fixture = {
    deploy                                         = true
    enabled                                        = true
    policy_endpoint_enabled                        = true
    artifact_s3_key                                = "lambda/d2/community.zip"
    artifact_s3_object_version                     = "d2-community-version"
    artifact_sha256                                = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    artifact_base64sha256                          = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI="
    lambda_extension_layer_arn                     = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
    scheduled_reserved_concurrency                 = 1
    signal_reserved_concurrency                    = 2
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
    provider_activation_allowed                    = true
    provider_private_egress                        = true
    provider_sources_json                          = "[{\"schemaVersion\":1,\"provider\":\"lever\",\"sourceId\":\"synthetic-lever\",\"enabled\":true,\"site\":\"synthetic\",\"region\":\"global\",\"companyName\":\"Synthetic Company\",\"verifiedCompanyDomain\":\"example.test\"}]"
    provider_verification_registrations_json       = "[{\"sourceId\":\"synthetic-lever\",\"provider\":\"lever\",\"pageVariant\":\"lever-posting-v1\",\"atsTenant\":\"synthetic\",\"sourcePolicyVersion\":\"d2-synthetic-source.v1\"}]"
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
    application_failure_alarm_threshold            = 0
    queue_age_alarm_threshold_seconds              = 300
    dead_letter_alarm_threshold                    = 0
    release_authority                              = "synthetic-release-authority"
  }
}

run "d2_defaults_create_nothing" {
  command = plan

  assert {
    condition = (
      !var.d2_community_runtime.deploy &&
      !var.d2_community_runtime.enabled &&
      !var.d2_community_runtime.maintenance_mode &&
      !var.d2_community_runtime.development_contributions_enabled &&
      var.d2_community_runtime.development_contribution_providers == tolist(["greenhouse"]) &&
      var.d2_community_runtime.signal_reserved_concurrency == 0 &&
      !var.d2_community_runtime.policy_endpoint_enabled &&
      length(aws_lambda_function.d2_community_scheduled) == 0 &&
      length(aws_lambda_function.d2_trust_signal) == 0 &&
      length(aws_sqs_queue.d2_trust_signal) == 0 &&
      length(aws_sqs_queue.d2_trust_signal_dead_letter) == 0 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 0 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 0 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 0 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 0 &&
      length(aws_nat_gateway.ingestion_provider) == 0 &&
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
      policy_endpoint_enabled                        = true
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
      provider_activation_allowed                    = false
      provider_private_egress                        = false
      provider_sources_json                          = ""
      provider_verification_registrations_json       = ""
      ugc_contribution_policy_version                = ""
      signed_policy_json                             = "{\"synthetic\":true}"
      signed_public_keys_json                        = "{\"synthetic-key\":\"public\"}"
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
      application_failure_alarm_threshold            = 0
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
      length(aws_cloudwatch_metric_alarm.d2_community_application_failures) == 5 &&
      alltrue([for alarm in aws_cloudwatch_metric_alarm.d2_community_application_failures : alarm.namespace == "AIJobApply/D2Community" && alarm.dimensions == null && alarm.treat_missing_data == "notBreaching" && length(alarm.alarm_actions) == 1 && length(alarm.ok_actions) == 1]) &&
      length(aws_cloudwatch_metric_alarm.d2_trust_signal_queue_age) == 1 &&
      length(aws_cloudwatch_metric_alarm.d2_trust_signal_dead_letter) == 1 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 0 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 0 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 0 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 1 &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "false" &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_CONTRIBUTION_ROUTES_ENABLED") &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_POLICY_ROUTE_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON == "{\"synthetic\":true}" &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "D2_DEPLOYMENT_ENVIRONMENT") &&
      length(aws_nat_gateway.this) == 0
    )
    error_message = "Dark deployment must create immutable compute, exact queues, IAM, alarms, and only the public signed-policy route; triggers and mutating routes must remain structurally absent."
  }
}

run "d2_activation_requires_and_wires_every_explicit_boundary" {
  command = plan

  variables {
    d2_community_runtime = var.d2_active_runtime_fixture
  }

  assert {
    condition = (
      !var.d2_community_runtime.maintenance_mode &&
      local.d2_community_operational &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 1 &&
      aws_cloudwatch_event_rule.d2_community_schedule[0].schedule_expression == "rate(5 minutes)" &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 1 &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].batch_size == 5 &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].scaling_config[0].maximum_concurrency == 2 &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].scaling_config[0].maximum_concurrency == aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 18 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 1 &&
      aws_apigatewayv2_route.d2_contribution_policy[0].authorization_type == "NONE" &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/jobs/contributions"].authorization_scopes) == toset(["jobs:contribute"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/admin/trust/cases"].authorization_scopes) == toset(["trust:review", "trust:case:open"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["GET /v1/saved-job-captures/{captureId}"].authorization_scopes) == toset(["jobs:read"]) &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON == "{\"synthetic\":true}" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED == "true" &&
      length(aws_nat_gateway.ingestion_provider) == 1 &&
      local.provider_private_egress &&
      length(jsondecode(aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON)) == 1 &&
      length(jsondecode(aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON)) == 1 &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON == "{\"synthetic\":true}" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON == "{\"synthetic-key\":\"public\"}" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_TRUST_POLICY_VERSION == "d2-synthetic-trust.v1" &&
      aws_lambda_function.d2_trust_signal[0].environment[0].variables.D2_COMMUNITY_PROCESSING_POLICY_VERSION == "d2-synthetic-processing.v1"
    )
    error_message = "Activation must bind the exact schedule, batch, policy, Trust, and separately scoped API routes."
  }
}


run "d2_active_signal_concurrency_rejects_one" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      signal_reserved_concurrency = 1
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_active_signal_concurrency_rejects_zero" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      signal_reserved_concurrency = 0
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_active_signal_concurrency_rejects_fractional" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      signal_reserved_concurrency = 2.5
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_active_signal_concurrency_rejects_over_limit" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      signal_reserved_concurrency = 6
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_active_signal_concurrency_upper_bound_is_shared" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      signal_reserved_concurrency = 5
    })
  }

  assert {
    condition = (
      aws_lambda_event_source_mapping.d2_trust_signal[0].scaling_config[0].maximum_concurrency == 5 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 5 &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1
    )
    error_message = "The SQS mapping and Trust reservation must share the reviewed upper bound without changing scheduled concurrency."
  }
}

run "d2_development_contributions_work_without_signatures_or_policy_endpoint" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge({
      for key, value in var.d2_active_runtime_fixture : key => value
      if !contains(["signed_policy_json", "signed_public_keys_json"], key)
      }, {
      development_contributions_enabled = true
      policy_endpoint_enabled           = false
    })
  }

  assert {
    condition = (
      local.d2_development_contributions_enabled &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 0 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 18 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 1 &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEPLOYMENT_ENVIRONMENT == "development" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEPLOYMENT_ENVIRONMENT == "development" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED == "true" &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON") &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON")
    )
    error_message = "Explicit development mode must wire both environment markers to intake and processing without a signed-policy dependency or an obligatory policy route."
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.NODE_ENV == "production" &&
      aws_lambda_function.gateway[0].environment[0].variables.OIDC_ISSUER == var.oidc_issuer &&
      aws_lambda_function.gateway[0].environment[0].variables.OIDC_AUDIENCE == var.oidc_audience &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_community_runtime.trust_reviewer_assignments_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_EVIDENCE_ALLOWLIST_JSON == var.d2_community_runtime.trust_evidence_allowlist_json &&
      aws_lambda_function.gateway[0].environment[0].variables.UGC_CONTRIBUTION_POLICY_VERSION == var.d2_community_runtime.ugc_contribution_policy_version &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_community_runtime.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_community_runtime.provider_verification_registrations_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_community_runtime.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_TRUST_EVIDENCE_ALLOWLIST_JSON == var.d2_community_runtime.trust_evidence_allowlist_json &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED") &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEPLOYMENT_ENVIRONMENT") &&
      aws_lambda_function.d2_trust_signal[0].environment[0].variables.D2_COMMUNITY_PROCESSING_POLICY_VERSION == var.d2_community_runtime.processing_policy_version &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2 &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].scaling_config[0].maximum_concurrency == 2 &&
      alltrue([for route in aws_apigatewayv2_route.d2_community_protected : route.authorization_type == "JWT"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/jobs/contributions"].authorization_scopes) == toset(["jobs:contribute"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/admin/trust/cases/{caseId}/appeal-resolution"].authorization_scopes) == toset(["trust:review", "trust:appeal:resolve"])
    )
    error_message = "Development contribution mode must preserve JWT identity, provider verification, Trust assignments/evidence, role scopes, and bounded concurrency; the Trust signal runtime must remain unchanged."
  }
}

run "d2_development_provider_selection_greenhouse" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["greenhouse"]
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_lever" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["lever"]
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["lever"]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["lever"]) &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_ashby" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["ashby"]
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["ashby"]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["ashby"]) &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_greenhouse_lever" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["greenhouse", "lever"]
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "lever"]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "lever"]) &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_greenhouse_ashby" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["greenhouse", "ashby"]
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "ashby"]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "ashby"]) &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_lever_ashby" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["lever", "ashby"]
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["lever", "ashby"]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["lever", "ashby"]) &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_all" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["greenhouse", "lever", "ashby"]
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "lever", "ashby"]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "lever", "ashby"]) &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_none" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = []
      policy_endpoint_enabled            = false
    })
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode([]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode([]) &&
      !contains(keys(aws_lambda_function.d2_trust_signal[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      var.d2_community_runtime.deploy && var.d2_community_runtime.enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_active_runtime_fixture.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_active_runtime_fixture.provider_verification_registrations_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_active_runtime_fixture.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2
    )
    error_message = "The exact development provider selection must reach only Gateway and scheduled processing, without changing source registrations, Trust identity, activation flags, or concurrency; the existing Greenhouse-only shape must remain unchanged."
  }
}

run "d2_development_provider_selection_rejects_duplicate" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["lever", "lever"]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_too_many" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["greenhouse", "lever", "ashby", "greenhouse"]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_unknown" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["workday"]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_case_changed" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["Lever"]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_whitespace" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = ["ashby "]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_null_element" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = true
      development_contribution_providers = [null]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_flag_off" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = false
      development_contribution_providers = ["lever"]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_deny_all_flag_off" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = false
      development_contribution_providers = []
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_staging" {
  command = plan

  variables {
    environment = "staging"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = false
      development_contribution_providers = ["lever"]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_production" {
  command = plan

  variables {
    environment = "production"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = false
      development_contribution_providers = ["ashby"]
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_deny_all_staging" {
  command = plan

  variables {
    environment = "staging"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = false
      development_contribution_providers = []
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_rejects_deny_all_production" {
  command = plan

  variables {
    environment = "production"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled  = false
      development_contribution_providers = []
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_provider_selection_does_not_enable_dark_runtime" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      deploy                             = true
      enabled                            = false
      policy_endpoint_enabled            = false
      provider_private_egress            = false
      development_contributions_enabled  = true
      development_contribution_providers = ["greenhouse", "lever", "ashby"]
    })
  }

  assert {
    condition = (
      !local.d2_community_enabled &&
      !local.d2_development_contributions_enabled &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON") &&
      length(aws_apigatewayv2_route.d2_community_protected) == 0 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 0 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 0 &&
      length(aws_nat_gateway.ingestion_provider) == 0
    )
    error_message = "A development provider selection must not activate a dark runtime, enable routes/triggers/egress, or leak selection into inactive runtime environments."
  }
}

run "d2_development_contributions_ignore_legacy_signatures" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled = true
      signed_policy_json                = "expired legacy signature data"
      signed_public_keys_json           = "removed legacy signing keys"
    })
  }

  assert {
    condition = (
      length(aws_apigatewayv2_route.d2_contribution_policy) == 1 &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_POLICY_ROUTE_ENABLED == "true" &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON") &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON")
    )
    error_message = "Retaining the legacy policy route must not reintroduce signed-policy data into enabled development intake or scheduled processing."
  }
}

run "d2_development_flag_alone_cannot_activate_runtime" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      deploy                            = false
      enabled                           = false
      policy_endpoint_enabled           = false
      provider_private_egress           = false
      development_contributions_enabled = true
    })
  }

  assert {
    condition = (
      !local.d2_development_contributions_enabled &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED") &&
      length(aws_lambda_function.d2_community_scheduled) == 0 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 0 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 0 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 0 &&
      length(aws_nat_gateway.ingestion_provider) == 0
    )
    error_message = "The development mode flag must never implicitly activate deployment, routes, schedules, queues, or egress."
  }
}

run "d2_development_mode_is_rejected_in_staging" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled = true
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_mode_is_rejected_in_production" {
  command = plan

  variables {
    environment = "production"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled = true
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_defaults_still_require_signed_policy" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      signed_policy_json      = ""
      signed_public_keys_json = ""
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_mode_preserves_configuration_size_limit" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled = true
      signed_policy_json                = ""
      signed_public_keys_json           = ""
      trust_evidence_allowlist_json     = jsonencode([join("", [for i in range(1000) : "aaa"])])
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_development_mode_still_requires_provider_verification" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      development_contributions_enabled        = true
      provider_verification_registrations_json = "[]"
    })
  }

  expect_failures = [var.d2_community_runtime]
}

run "d2_maintenance_pauses_execution_without_changing_the_activated_boundary" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, { maintenance_mode = true })
  }

  assert {
    condition = (
      local.d2_community_enabled && !local.d2_community_operational &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "false" &&
      aws_lambda_function.d2_trust_signal[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "false" &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 0 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 0 &&
      aws_cloudwatch_event_rule.d2_community_schedule[0].state == "DISABLED" &&
      !aws_lambda_event_source_mapping.d2_trust_signal[0].enabled &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "false" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED == "false" &&
      var.d2_community_runtime.scheduled_reserved_concurrency == 1 &&
      var.d2_community_runtime.signal_reserved_concurrency == 2 &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].scaling_config[0].maximum_concurrency == 2
    )
    error_message = "Maintenance must pause both existing handlers, reservations, triggers and mutation/review gates while retaining valid configured concurrency."
  }

  assert {
    condition = (
      length(aws_lambda_function.d2_community_scheduled) == 1 &&
      length(aws_lambda_function.d2_trust_signal) == 1 &&
      length(aws_lambda_alias.d2_community_scheduled) == 1 &&
      length(aws_lambda_alias.d2_trust_signal) == 1 &&
      length(aws_iam_role.d2_community_scheduled) == 1 &&
      length(aws_iam_role.d2_trust_signal) == 1 &&
      length(aws_iam_role_policy.d2_community_scheduled) == 1 &&
      length(aws_iam_role_policy.d2_trust_signal) == 1 &&
      length(aws_sqs_queue.d2_trust_signal) == 1 &&
      length(aws_sqs_queue.d2_trust_signal_dead_letter) == 1 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 1 &&
      length(aws_cloudwatch_event_target.d2_community_schedule) == 1 &&
      length(aws_lambda_permission.d2_community_schedule) == 1 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 1 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 18 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 1 &&
      length(aws_nat_gateway.ingestion_provider) == 1 &&
      local.provider_private_egress &&
      length(aws_subnet.ingestion_provider) == 2 &&
      length(aws_cloudwatch_metric_alarm.d2_community_lambda_errors) == 2 &&
      length(aws_cloudwatch_metric_alarm.d2_community_lambda_throttles) == 2 &&
      length(aws_cloudwatch_metric_alarm.d2_community_lambda_duration) == 2 &&
      length(aws_cloudwatch_metric_alarm.d2_community_application_failures) == 5 &&
      length(aws_cloudwatch_metric_alarm.d2_trust_signal_queue_age) == 1 &&
      length(aws_cloudwatch_metric_alarm.d2_trust_signal_dead_letter) == 1 &&
      aws_lambda_function.d2_community_scheduled[0].s3_key == var.d2_community_runtime.artifact_s3_key &&
      aws_lambda_function.d2_community_scheduled[0].s3_object_version == var.d2_community_runtime.artifact_s3_object_version &&
      aws_lambda_function.d2_trust_signal[0].s3_key == var.d2_community_runtime.artifact_s3_key &&
      aws_lambda_function.d2_trust_signal[0].s3_object_version == var.d2_community_runtime.artifact_s3_object_version &&
      aws_sqs_queue.d2_trust_signal[0].message_retention_seconds == var.d2_community_runtime.queue_message_retention_seconds &&
      aws_sqs_queue.d2_trust_signal_dead_letter[0].message_retention_seconds == var.d2_community_runtime.dead_letter_retention_seconds &&
      aws_cloudwatch_event_rule.d2_community_schedule[0].schedule_expression == var.d2_community_runtime.schedule_expression
    )
    error_message = "Maintenance must retain all routes, queues, immutable artifact inputs, aliases, IAM, alarms, provider networking, and configured scheduling/retention."
  }

  assert {
    condition = (
      aws_lambda_function.gateway[0].environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_POLICY_ROUTE_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.OIDC_ISSUER == var.oidc_issuer &&
      aws_lambda_function.gateway[0].environment[0].variables.OIDC_AUDIENCE == var.oidc_audience &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_community_runtime.trust_reviewer_assignments_json &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_EVIDENCE_ALLOWLIST_JSON == var.d2_community_runtime.trust_evidence_allowlist_json &&
      aws_lambda_function.gateway[0].environment[0].variables.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON == var.d2_community_runtime.signed_policy_json &&
      aws_lambda_function.gateway[0].environment[0].variables.UGC_CONTRIBUTION_POLICY_VERSION == var.d2_community_runtime.ugc_contribution_policy_version &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_SOURCES_JSON == var.d2_community_runtime.provider_sources_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON == var.d2_community_runtime.provider_verification_registrations_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON == var.d2_community_runtime.trust_reviewer_assignments_json &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_TRUST_POLICY_VERSION == var.d2_community_runtime.trust_policy_version &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON == var.d2_community_runtime.signed_policy_json &&
      aws_lambda_function.d2_trust_signal[0].environment[0].variables.D2_COMMUNITY_PROCESSING_POLICY_VERSION == var.d2_community_runtime.processing_policy_version &&
      alltrue([for route in aws_apigatewayv2_route.d2_community_protected : route.authorization_type == "JWT"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/jobs/contributions"].authorization_scopes) == toset(["jobs:contribute"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["POST /v1/admin/trust/cases/{caseId}/appeal-resolution"].authorization_scopes) == toset(["trust:review", "trust:appeal:resolve"]) &&
      toset(aws_apigatewayv2_route.d2_community_protected["GET /v1/saved-job-captures/{captureId}"].authorization_scopes) == toset(["jobs:read"])
    )
    error_message = "Maintenance must retain private captures, read-only policy, provider/Trust configuration, identity and exact authorization scopes without adding authority."
  }
}

run "d2_development_maintenance_retains_unsigned_mode_and_provider_selection" {
  command = plan

  variables {
    environment = "development"
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      maintenance_mode                   = true
      development_contributions_enabled  = true
      development_contribution_providers = ["greenhouse", "lever", "ashby"]
      policy_endpoint_enabled            = false
      signed_policy_json                 = ""
      signed_public_keys_json            = ""
    })
  }

  assert {
    condition = (
      local.d2_development_contributions_enabled && !local.d2_community_operational &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "false" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED == "false" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "lever", "ashby"]) &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON == jsonencode(["greenhouse", "lever", "ashby"]) &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON") &&
      !contains(keys(aws_lambda_function.d2_community_scheduled[0].environment[0].variables), "JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON") &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "false" &&
      aws_lambda_function.d2_trust_signal[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "false" &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 0 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 0 &&
      aws_cloudwatch_event_rule.d2_community_schedule[0].state == "DISABLED" &&
      !aws_lambda_event_source_mapping.d2_trust_signal[0].enabled &&
      length(aws_apigatewayv2_route.d2_community_protected) == 18 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 0 &&
      length(aws_nat_gateway.ingestion_provider) == 1
    )
    error_message = "Development maintenance must pause execution without removing persistent development mode, selected providers, routes, or networking."
  }
}

run "d2_maintenance_false_restores_reviewed_execution_limits" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      maintenance_mode               = false
      scheduled_reserved_concurrency = 3
      signal_reserved_concurrency    = 5
    })
  }

  assert {
    condition = (
      local.d2_community_operational &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 3 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 5 &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].scaling_config[0].maximum_concurrency == 5 &&
      aws_cloudwatch_event_rule.d2_community_schedule[0].state == "ENABLED" &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].enabled &&
      aws_lambda_function.d2_community_scheduled[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "true" &&
      aws_lambda_function.d2_trust_signal[0].environment[0].variables.D2_COMMUNITY_RUNTIME_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED == "true" &&
      length(aws_apigatewayv2_route.d2_community_protected) == 18
    )
    error_message = "Leaving maintenance must restore exact configured bounds and existing triggers/routes, not hardcoded concurrency defaults."
  }
}

run "d2_maintenance_alone_does_not_activate_or_deploy" {
  command = plan

  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, {
      deploy                      = false
      enabled                     = false
      maintenance_mode            = true
      policy_endpoint_enabled     = false
      provider_activation_allowed = false
      provider_private_egress     = false
    })
  }

  assert {
    condition = (
      !local.d2_community_deployed && !local.d2_community_enabled && !local.d2_community_operational &&
      length(aws_lambda_function.d2_community_scheduled) == 0 &&
      length(aws_lambda_function.d2_trust_signal) == 0 &&
      length(aws_sqs_queue.d2_trust_signal) == 0 &&
      length(aws_cloudwatch_event_rule.d2_community_schedule) == 0 &&
      length(aws_lambda_event_source_mapping.d2_trust_signal) == 0 &&
      length(aws_apigatewayv2_route.d2_community_protected) == 0 &&
      length(aws_nat_gateway.ingestion_provider) == 0 &&
      !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "D2_CONTRIBUTION_ROUTES_ENABLED")
    )
    error_message = "A maintenance preference alone cannot deploy, activate, or authorize any D2 capability."
  }
}

run "d2_maintenance_keeps_live_d1_routes_and_workflow_triggers_available" {
  command = plan

  variables {
    serverless_runtime_enabled                            = true
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
    d2_community_runtime                                  = merge(var.d2_active_runtime_fixture, { maintenance_mode = true })
  }

  assert {
    condition = (
      var.serverless_runtime_enabled &&
      length(aws_apigatewayv2_route.gateway) == 1 &&
      length(aws_apigatewayv2_route.gateway_lambda_public) == 2 &&
      aws_lambda_event_source_mapping.outbox_starter[0].enabled &&
      aws_cloudwatch_event_rule.outbox_reconciler[0].state == "ENABLED" &&
      aws_cloudwatch_event_rule.profile_readiness_terminal[0].state == "ENABLED" &&
      aws_lambda_function.gateway[0].reserved_concurrent_executions == var.gateway_lambda_reserved_concurrency &&
      aws_lambda_function.gateway[0].environment[0].variables.OUTBOX_DISPATCH_TARGET == "lambda_durable" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "false" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED == "false" &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 0 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 0
    )
    error_message = "D2 maintenance must not disable the D1 gateway, public health routes, outbox, profile workflows, or private captures."
  }
}

run "outbox_pause_keeps_d2_routes_and_community_workers_available" {
  command = plan

  variables {
    serverless_runtime_enabled                            = true
    outbox_starts_paused                                  = true
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
    d2_community_runtime                                  = var.d2_active_runtime_fixture
  }

  assert {
    condition = (
      !aws_lambda_event_source_mapping.outbox_starter[0].enabled &&
      local.d2_community_operational &&
      length(aws_apigatewayv2_route.gateway) == 1 &&
      length(aws_apigatewayv2_route.d2_community_protected) > 0 &&
      length(aws_apigatewayv2_route.d2_contribution_policy) == 1 &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_PRIVATE_CAPTURE_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_CONTRIBUTION_ROUTES_ENABLED == "true" &&
      aws_lambda_function.gateway[0].environment[0].variables.D2_TRUST_REVIEWER_ROUTES_ENABLED == "true" &&
      aws_lambda_function.d2_community_scheduled[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.d2_trust_signal[0].reserved_concurrent_executions == 2 &&
      aws_cloudwatch_event_rule.d2_community_schedule[0].state == "ENABLED" &&
      aws_lambda_event_source_mapping.d2_trust_signal[0].enabled
    )
    error_message = "A profile-workflow starter pause must not put D2 into maintenance or disable its independent routes and workers."
  }
}

run "d2_maintenance_still_rejects_invalid_configured_signal_concurrency" {
  command = plan
  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, { maintenance_mode = true, signal_reserved_concurrency = 1 })
  }
  expect_failures = [var.d2_community_runtime]
}

run "d2_maintenance_still_rejects_invalid_configured_scheduled_concurrency" {
  command = plan
  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, { maintenance_mode = true, scheduled_reserved_concurrency = 0 })
  }
  expect_failures = [var.d2_community_runtime]
}

run "d2_maintenance_still_requires_provider_registrations" {
  command = plan
  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, { maintenance_mode = true, provider_verification_registrations_json = "[]" })
  }
  expect_failures = [var.d2_community_runtime]
}

run "d2_maintenance_still_requires_reviewer_assignments" {
  command = plan
  variables {
    d2_community_runtime = merge(var.d2_active_runtime_fixture, { maintenance_mode = true, trust_reviewer_assignments_json = "[]" })
  }
  expect_failures = [var.d2_community_runtime]
}
