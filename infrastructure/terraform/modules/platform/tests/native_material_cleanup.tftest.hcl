mock_provider "aws" {
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::111122223333:role/synthetic-audit" } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-Abc123" } }
  mock_resource "aws_cloudwatch_event_rule" { defaults = { arn = "arn:aws:events:us-east-2:111122223333:rule/ai-job-apply-development-native-material-cleanup-worker" } }

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

run "absent_by_default" {
  command = plan
  assert {
    condition     = length(aws_lambda_function.native_cleanup) == 0 && length(aws_cloudwatch_event_rule.native_cleanup) == 0 && length(aws_iam_role.native_cleanup) == 0
    error_message = "No release means no audit runtime or schedule."
  }
}
run "immutable_private_release_stays_disabled" {
  command = apply
  variables {
    native_cleanup_deployments = [{ cluster_arn = "arn:aws:ecs:us-east-2:111122223333:cluster/synthetic", task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:7", container_name = "native-material" }]
    native_cleanup_release = {
      source_sha            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      artifact_sha256       = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      artifact_base64sha256 = "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s="
      artifact_version      = "synthetic-version"
      artifact_key          = "lambda/native-material/cleanup/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-material-cleanup-worker-lambda.zip"
      extension_layer_arn   = "arn:aws:lambda:us-east-2:111122223333:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1"
    }
  }
  assert {
    condition     = length(aws_vpc_endpoint.secretsmanager) == 1 && aws_vpc_endpoint.secretsmanager[0].private_dns_enabled && contains(flatten([for statement in data.aws_iam_policy_document.secrets_endpoint[0].statement : flatten([for condition in statement.condition : condition.values])]), aws_iam_role.native_cleanup[0].arn)
    error_message = "A standalone maintenance release must provision private secret connectivity and allow its exact role."
  }

  assert {
    condition     = aws_cloudwatch_event_rule.native_cleanup[0].state == "DISABLED" && aws_lambda_function.native_cleanup[0].environment[0].variables.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED == "false"
    error_message = "Deployment alone must not authorize cleanup or scheduled invocation."
  }
  assert {
    condition     = aws_cloudwatch_event_target.native_cleanup[0].retry_policy[0].maximum_event_age_in_seconds == 60 && aws_cloudwatch_event_target.native_cleanup[0].retry_policy[0].maximum_retry_attempts == 0
    error_message = "EventBridge delivery age must satisfy the service minimum while scheduled cleanup retries stay disabled."
  }
  assert {
    condition     = aws_cloudwatch_event_target.native_cleanup[0].arn == aws_lambda_function.native_cleanup[0].qualified_arn && aws_lambda_permission.native_cleanup[0].qualifier == aws_lambda_function.native_cleanup[0].version && jsondecode(aws_cloudwatch_event_target.native_cleanup[0].input).action == "drain" && aws_lambda_function.native_cleanup[0].s3_object_version == "synthetic-version"
    error_message = "Invocation must bind numeric artifact and the closed scalar cleanup envelope."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.native_cleanup[0].policy).Statement[0].Resource == "arn:aws:ecs:us-east-2:111122223333:task/synthetic/*" && contains(jsondecode(aws_iam_role_policy.native_cleanup[0].policy).Statement[0].Action, "ecs:StopTask") && aws_lambda_function.native_cleanup[0].timeout == 240 && aws_lambda_function.native_cleanup[0].reserved_concurrent_executions == 1
    error_message = "Cleanup must stop only original cluster tasks, with bounded time and concurrency."
  }
  assert {
    condition     = length(aws_vpc_endpoint.native_resume_api) == 1 && contains(flatten([for s in local.native_resume_ecs_endpoint_policy.Statement : try(s.Condition.ArnEquals["aws:PrincipalArn"], [])]), "arn:aws:iam::111122223333:role/ai-job-apply-development-native-material-cleanup-worker")
    error_message = "Standalone cleanup must have private ECS access for its exact role."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.native_cleanup[0].policy).Statement[3].Resource == aws_secretsmanager_secret.database_url.arn && contains(jsondecode(aws_iam_role_policy.native_cleanup[0].policy).Statement[5].Action, "s3:*") && length(aws_cloudwatch_metric_alarm.native_cleanup) == 2
    error_message = "Maintenance needs the owning secret, explicit content denial and delivery/execution alarms."
  }
}
run "activation_requires_release" {
  command = plan
  variables { native_cleanup_enabled = true }
  expect_failures = [var.native_cleanup_release]
}
run "schedule_requires_runtime" {
  command = plan
  variables { native_cleanup_schedule_enabled = true }
  expect_failures = [var.native_cleanup_schedule_enabled]
}


run "reject_foreign_cluster" {
  command = plan
  variables { native_cleanup_deployments = [{ cluster_arn = "arn:aws:ecs:us-east-2:999999999999:cluster/foreign", task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:7", container_name = "native-material" }] }
  expect_failures = [var.native_cleanup_deployments]
}

run "enabled_schedule_uses_numeric_worker" {
  command = apply
  variables {
    native_cleanup_enabled          = true
    native_cleanup_schedule_enabled = true
    native_cleanup_deployments      = [{ cluster_arn = "arn:aws:ecs:us-east-2:111122223333:cluster/synthetic", task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:7", container_name = "native-material" }]
    native_cleanup_release = {
      source_sha            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      artifact_sha256       = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      artifact_base64sha256 = "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s="
      artifact_version      = "synthetic-version"
      artifact_key          = "lambda/native-material/cleanup/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-material-cleanup-worker-lambda.zip"
      extension_layer_arn   = "arn:aws:lambda:us-east-2:111122223333:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1"
    }
  }
  assert {
    condition     = aws_cloudwatch_event_rule.native_cleanup[0].state == "ENABLED" && aws_cloudwatch_event_rule.native_cleanup[0].schedule_expression == "rate(1 minute)" && aws_lambda_function.native_cleanup[0].environment[0].variables.NATIVE_APPLICATION_DISPOSAL_ENABLED == "true" && aws_lambda_function.native_cleanup[0].environment[0].variables.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED == "true"
    error_message = "Reviewed activation must schedule the bounded worker and both runtime gates."
  }
}
