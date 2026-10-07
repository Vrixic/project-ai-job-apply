mock_provider "aws" {
  mock_resource "aws_cloudwatch_event_rule" { defaults = { arn = "arn:aws:events:us-east-2:123456789012:rule/synthetic-dispatch" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { region = "us-east-2" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/synthetic-runtime" } }
  mock_resource "aws_lambda_function" { defaults = { qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-control:1", version = "1" } }
  mock_resource "aws_cloudformation_stack" { defaults = { outputs = { DurableVersionArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:2" } } }
}
variables {
  account_id  = "123456789012"
  environment = "development"
  release = {
    "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "artifact_bucket" : "synthetic-artifacts",
    "artifacts" : {
      "control" : {
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=",
        "version_id" : "synthetic-version",
        "key" : "lambda/documents/native-resume/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-resume-preparation-control-lambda.zip"
      },
      "durable" : {
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=",
        "version_id" : "synthetic-version",
        "key" : "lambda/documents/native-resume/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-resume-preparation-durable-lambda.zip"
      },
      "dispatch" : {
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=",
        "version_id" : "synthetic-version",
        "key" : "lambda/documents/native-resume/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-resume-request-dispatch-lambda.zip"
      }
    },
    "cluster_arn" : "arn:aws:ecs:us-east-2:123456789012:cluster/native-resume",
    "task_definition_arn" : "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-resume:7",
    "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/database-Abc123",
    "platform_kms_key_arn" : "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012",
    "extension_layer_arn" : "arn:aws:lambda:us-east-2:123456789012:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1",
    "subnet_ids" : [
      "subnet-0123456789abcdef0",
      "subnet-0123456789abcdef1"
    ],
    "security_group_ids" : [
      "sg-0123456789abcdef0"
    ],
    "image" : "123456789012.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/native-resume@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "task_subnet_ids" : [
      "subnet-0123456789abcdef0",
      "subnet-0123456789abcdef1"
    ],
    "task_security_group_ids" : [
      "sg-0123456789abcdef0"
    ]
  }
}
run "absent_by_default" {
  command = plan
  variables { release = null }
  assert {
    condition     = length(aws_lambda_function.control) == 0 && length(aws_lambda_function.dispatch) == 0 && length(aws_cloudformation_stack.durable) == 0 && length(aws_iam_role.runtime) == 0 && length(aws_cloudwatch_event_rule.dispatch) == 0
    error_message = "No release means no preparation resources."
  }
}
run "connected_release_is_disabled" {
  command = apply
  assert {
    condition     = aws_lambda_function.control[0].environment[0].variables.NATIVE_RESUME_NEW_LAUNCH_ENABLED == "false" && aws_lambda_function.control[0].environment[0].variables.NATIVE_RESUME_PREPARATION_CONTROL_ENABLED == "false" && aws_lambda_function.dispatch[0].environment[0].variables.NATIVE_RESUME_REQUEST_DISPATCH_ENABLED == "false" && aws_cloudwatch_event_rule.dispatch[0].state == "DISABLED"
    error_message = "Deployment must not activate work."
  }
  assert {
    condition     = aws_lambda_function.dispatch[0].environment[0].variables.NATIVE_RESUME_PREPARATION_WORKFLOW_ARN == aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"] && jsondecode(aws_cloudformation_stack.durable[0].template_body).Resources.DurableFunction.Properties.Environment.Variables.NATIVE_RESUME_PREPARATION_CONTROL_FUNCTION_ARN == aws_lambda_function.control[0].qualified_arn
    error_message = "Dispatch and durable must pin the actual preceding numeric versions."
  }
  assert {
    condition     = jsondecode(aws_cloudformation_stack.durable[0].template_body).Resources.DurableFunction.Properties.DurableConfig.KMSKeyArn == var.release.platform_kms_key_arn && !contains(keys(jsondecode(aws_cloudformation_stack.durable[0].template_body).Resources.DurableFunction.Properties.Environment.Variables), "DATABASE_SECRET_ID") && jsondecode(aws_cloudformation_stack.durable[0].template_body).Resources.DurableVersion.DeletionPolicy == "Retain"
    error_message = "Durable scalar state must be encrypted and have no database configuration."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.control[0].policy).Statement[1].Resource == var.release.task_definition_arn && jsondecode(aws_iam_role_policy.control[0].policy).Statement[1].Condition.ArnEquals["ecs:cluster"] == var.release.cluster_arn && jsondecode(aws_iam_role_policy.control[0].policy).Statement[3].Resource == [local.task_role, local.execution_role] && jsondecode(aws_iam_role_policy.dispatch[0].policy).Statement[0].Resource == aws_cloudformation_stack.durable[0].outputs["DurableVersionArn"]
    error_message = "Launch/pass-role/workflow permissions must stay original-release scoped."
  }
  assert {
    condition     = aws_cloudwatch_event_target.dispatch[0].arn == aws_lambda_function.dispatch[0].qualified_arn && aws_lambda_permission.dispatch[0].qualifier == aws_lambda_function.dispatch[0].version && aws_cloudwatch_event_target.dispatch[0].input == jsonencode({ schemaVersion = 1, action = "sweep" })
    error_message = "Only the exact numeric dispatcher may receive the scalar scheduled sweep."
  }
}
run "launch_can_remain_off" {
  command = plan
  variables { enabled = true }
  assert {
    condition     = aws_lambda_function.control[0].environment[0].variables.NATIVE_RESUME_PREPARATION_CONTROL_ENABLED == "true" && aws_lambda_function.control[0].environment[0].variables.NATIVE_RESUME_NEW_LAUNCH_ENABLED == "false" && aws_cloudwatch_event_rule.dispatch[0].state == "DISABLED"
    error_message = "Runtime availability must not imply task launch or scheduling."
  }
}
run "schedule_requires_launch" {
  command = plan
  variables { schedule_enabled = true }
  expect_failures = [var.schedule_enabled]
}
run "foreign_target_refused" {
  command = plan
  variables { account_id = "111122223333" }
  expect_failures = [var.release]
}
run "activation_requires_release" {
  command = plan
  variables {
    release = null
    enabled = true
  }
  expect_failures = [var.release]
}
