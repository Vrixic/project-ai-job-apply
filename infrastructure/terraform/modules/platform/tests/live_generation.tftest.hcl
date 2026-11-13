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

run "live_generation_absent_by_default" {
  command = plan
  assert {
    condition     = length(aws_vpc_endpoint.live_generation_runtime) == 0 && length(aws_security_group.live_generation_endpoint) == 0 && length(aws_cloudwatch_metric_alarm.live_generation_burst) == 0
    error_message = "No Bedrock endpoint, group or alarm may exist unless live generation is configured."
  }
}

run "live_generation_has_an_exact_private_endpoint_and_a_burst_alarm" {
  command = plan
  variables {
    live_generation = {
      profile_id              = "us.anthropic.claude-sonnet-4-6"
      foundation_model_id     = "anthropic.claude-sonnet-4-6"
      destination_regions     = ["us-east-1", "us-east-2", "us-west-2"]
      task_role_revisions     = ["5"]
      task_security_group_ids = ["sg-0123456789abcdef0"]
    }
  }
  assert {
    condition = (
      aws_vpc_endpoint.live_generation_runtime[0].service_name == "com.amazonaws.us-east-2.bedrock-runtime" &&
      aws_vpc_endpoint.live_generation_runtime[0].vpc_endpoint_type == "Interface" &&
      aws_vpc_endpoint.live_generation_runtime[0].private_dns_enabled &&
      length(aws_vpc_endpoint.live_generation_runtime[0].subnet_ids) == 1
    )
    error_message = "The Bedrock runtime endpoint must be one private interface endpoint with private DNS."
  }
  assert {
    condition = (
      length(aws_security_group.live_generation_endpoint[0].ingress) == 1 &&
      one(aws_security_group.live_generation_endpoint[0].ingress).from_port == 443 &&
      one(aws_security_group.live_generation_endpoint[0].ingress).to_port == 443 &&
      one(aws_security_group.live_generation_endpoint[0].ingress).protocol == "tcp" &&
      one(aws_security_group.live_generation_endpoint[0].ingress).security_groups == toset(["sg-0123456789abcdef0"])
    )
    error_message = "Only the native task group may reach the endpoint, on 443 over TCP."
  }
  assert {
    condition = jsondecode(aws_vpc_endpoint.live_generation_runtime[0].policy) == {
      Version = "2012-10-17"
      Statement = [{
        Sid       = "InvokeReviewedModelFromNativeResumeTasks"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:us-east-2:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6",
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6",
          "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6",
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6"
        ]
        Condition = { ArnEquals = { "aws:PrincipalArn" = ["arn:aws:iam::111122223333:role/ai-job-apply-development-native-resume-r5-task"] } }
      }]
    }
    error_message = "The endpoint policy must allow only InvokeModel on the reviewed profile and models, only for the reviewed native resume task roles."
  }
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.live_generation_burst[0].namespace == "AWS/Bedrock" &&
      aws_cloudwatch_metric_alarm.live_generation_burst[0].metric_name == "Invocations" &&
      aws_cloudwatch_metric_alarm.live_generation_burst[0].dimensions == tomap({ ModelId = "us.anthropic.claude-sonnet-4-6" }) &&
      aws_cloudwatch_metric_alarm.live_generation_burst[0].period == 3600 &&
      aws_cloudwatch_metric_alarm.live_generation_burst[0].threshold == 30 &&
      aws_cloudwatch_metric_alarm.live_generation_burst[0].statistic == "Sum" &&
      aws_cloudwatch_metric_alarm.live_generation_burst[0].treat_missing_data == "notBreaching"
    )
    error_message = "The burst alarm must watch invocations of the reviewed profile per hour and alert the operational topic."
  }
}

run "live_generation_endpoint_is_dropped_with_private_service_endpoints_but_the_alarm_stays" {
  command = plan
  variables {
    private_service_endpoints_enabled = false
    live_generation = {
      profile_id              = "us.anthropic.claude-sonnet-4-6"
      foundation_model_id     = "anthropic.claude-sonnet-4-6"
      destination_regions     = ["us-east-2"]
      task_role_revisions     = ["5"]
      task_security_group_ids = ["sg-0123456789abcdef0"]
    }
  }
  assert {
    condition     = length(aws_vpc_endpoint.live_generation_runtime) == 0 && length(aws_security_group.live_generation_endpoint) == 0 && length(aws_cloudwatch_metric_alarm.live_generation_burst) == 1
    error_message = "A drained shutdown must remove the billable endpoint and keep the alarm."
  }
}

run "live_generation_profile_must_name_its_foundation_model" {
  command = plan
  variables {
    live_generation = {
      profile_id              = "us.anthropic.claude-fable-5"
      foundation_model_id     = "anthropic.claude-sonnet-4-6"
      destination_regions     = ["us-east-2"]
      task_role_revisions     = ["5"]
      task_security_group_ids = ["sg-0123456789abcdef0"]
    }
  }
  expect_failures = [var.live_generation]
}

run "live_generation_wildcard_region_refused" {
  command = plan
  variables {
    live_generation = {
      profile_id              = "us.anthropic.claude-sonnet-4-6"
      foundation_model_id     = "anthropic.claude-sonnet-4-6"
      destination_regions     = ["us-east-2", "*"]
      task_role_revisions     = ["5"]
      task_security_group_ids = ["sg-0123456789abcdef0"]
    }
  }
  expect_failures = [var.live_generation]
}

run "live_generation_non_us_region_refused" {
  command = plan
  variables {
    live_generation = {
      profile_id              = "us.anthropic.claude-sonnet-4-6"
      foundation_model_id     = "anthropic.claude-sonnet-4-6"
      destination_regions     = ["us-east-2", "eu-west-1"]
      task_role_revisions     = ["5"]
      task_security_group_ids = ["sg-0123456789abcdef0"]
    }
  }
  expect_failures = [var.live_generation]
}

run "live_generation_needs_task_groups_and_revisions" {
  command = plan
  variables {
    live_generation = {
      profile_id              = "us.anthropic.claude-sonnet-4-6"
      foundation_model_id     = "anthropic.claude-sonnet-4-6"
      destination_regions     = ["us-east-2"]
      task_role_revisions     = []
      task_security_group_ids = []
    }
  }
  expect_failures = [var.live_generation]
}

run "live_generation_outputs_are_the_exact_arns" {
  command = plan
  variables {
    live_generation = {
      profile_id              = "us.anthropic.claude-sonnet-4-6"
      foundation_model_id     = "anthropic.claude-sonnet-4-6"
      destination_regions     = ["us-west-2", "us-east-1", "us-east-2"]
      task_role_revisions     = ["5"]
      task_security_group_ids = ["sg-0123456789abcdef0"]
    }
  }
  assert {
    condition = (
      output.live_generation_profile_arn == "arn:aws:bedrock:us-east-2:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6" &&
      jsonencode(output.live_generation_foundation_model_arns) == jsonencode([
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6"
      ])
    )
    error_message = "The task roles must receive the exact reviewed profile ARN and one sorted foundation model ARN per destination region."
  }
}

run "live_generation_outputs_are_empty_by_default" {
  command = plan
  assert {
    condition     = output.live_generation_profile_arn == null && length(output.live_generation_foundation_model_arns) == 0
    error_message = "Without live generation the platform must expose no model ARN."
  }
}
