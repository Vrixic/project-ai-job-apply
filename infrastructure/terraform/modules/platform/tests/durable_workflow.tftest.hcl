mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-2a", "us-east-2b"]
    }
  }

  mock_data "aws_region" {
    defaults = {
      region = "us-east-2"
      name   = "us-east-2"
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111122223333"
    }
  }

  mock_data "aws_iam_policy" {
    defaults = {
      arn = "arn:aws:iam::111122223333:policy/ai-job-apply-development-workload-boundary"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
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
}

mock_provider "random" {
}

mock_provider "time" {
}

run "durable_boundary_is_dark_encrypted_and_replay_safe" {
  command = plan

  variables {
    name        = "ai-job-apply"
    environment = "development"
    vpc_cidr    = "10.20.0.0/16"

    gateway_image              = "example.invalid/gateway@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    worker_image               = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    oidc_issuer                = "https://example.auth0.com/"
    temporal_address           = "example.tmprl.cloud:7233"
    temporal_namespace         = "example.tmprl.cloud"
    deploy_applications        = true
    run_continuous_ecs_runtime = false

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

  assert {
    condition     = length(aws_cloudformation_stack.profile_readiness_durable) == 1
    error_message = "The enabled profile-readiness boundary must own exactly one durable stack."
  }

  assert {
    condition = (
      length(time_sleep.profile_readiness_durable_policy_propagation) == 1 &&
      time_sleep.profile_readiness_durable_policy_propagation[0].create_duration == "45s"
    )
    error_message = "Durable creation must wait for its exact IAM policy to propagate."
  }

  assert {
    condition = (
      aws_lambda_function.profile_readiness_activity[0].reserved_concurrent_executions == 1 &&
      length(aws_lambda_function.profile_readiness_activity[0].vpc_config) == 1 &&
      aws_lambda_function.profile_readiness_terminal[0].reserved_concurrent_executions == 1 &&
      length(aws_lambda_function.profile_readiness_terminal[0].vpc_config) == 1
    )
    error_message = "Database handlers must remain private and capped at one concurrent environment each."
  }

  assert {
    condition     = aws_cloudwatch_event_rule.profile_readiness_terminal[0].state == "DISABLED"
    error_message = "Dark terminal recovery must remain disabled until a separately reviewed cutover."
  }

  assert {
    condition = (
      aws_ecs_service.gateway[0].desired_count == 0 &&
      aws_ecs_service.worker[0].desired_count == 0
    )
    error_message = "The accepted zero-traffic posture must retain both ECS services at zero desired tasks."
  }

  assert {
    condition = (
      !aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0].actions_enabled &&
      aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0].treat_missing_data == "notBreaching" &&
      !aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0].actions_enabled &&
      aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0].treat_missing_data == "notBreaching"
    )
    error_message = "Idle ECS heartbeat alarms must be non-notifying and treat expected silence as healthy."
  }

}

run "continuous_ecs_runtime_remains_the_module_default" {
  command = plan

  variables {
    name        = "ai-job-apply"
    environment = "development"
    vpc_cidr    = "10.20.0.0/16"

    gateway_image       = "example.invalid/gateway@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    worker_image        = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    oidc_issuer         = "https://example.auth0.com/"
    temporal_address    = "example.tmprl.cloud:7233"
    temporal_namespace  = "example.tmprl.cloud"
    deploy_applications = true
  }

  assert {
    condition = (
      aws_ecs_service.gateway[0].desired_count == 1 &&
      aws_ecs_service.worker[0].desired_count == 1
    )
    error_message = "The reusable platform module must still require an explicit environment decision to idle ECS."
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0].actions_enabled &&
      aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0].treat_missing_data == "breaching" &&
      aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0].actions_enabled &&
      aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0].treat_missing_data == "breaching"
    )
    error_message = "Continuous ECS heartbeat alarms must remain notifying and fail closed on missing data."
  }
}
