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
      },
      "observer" : {
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=",
        "version_id" : "synthetic-version",
        "key" : "lambda/documents/native-resume/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-resume-task-observer-lambda.zip"
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
    "observer_dead_letter_arn" : "arn:aws:sqs:us-east-2:123456789012:ai-job-apply-development-resume-observation-dlq",
    "image" : "123456789012.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/native-resume@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "task_assign_public_ip" : "DISABLED",
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
    condition     = aws_cloudwatch_event_rule.observer[0].state == "DISABLED" && aws_lambda_function.observer[0].environment[0].variables.NATIVE_RESUME_TASK_OBSERVER_ENABLED == "false" && aws_lambda_function.observer[0].dead_letter_config[0].target_arn == var.release.observer_dead_letter_arn && aws_cloudwatch_event_target.observer[0].dead_letter_config[0].arn == var.release.observer_dead_letter_arn
    error_message = "Observer/event delivery must remain disabled and retain failures in the reviewed queue."
  }
  assert {
    condition     = aws_lambda_permission.observer[0].qualifier == aws_lambda_function.observer[0].version && aws_cloudwatch_event_target.observer[0].arn == aws_lambda_function.observer[0].qualified_arn && jsondecode(aws_cloudwatch_event_rule.observer[0].event_pattern).detail.taskDefinitionArn == [var.release.task_definition_arn] && jsondecode(aws_cloudwatch_event_rule.observer[0].event_pattern).detail.lastStatus == ["STOPPED"] && aws_iam_role.runtime["observer"].permissions_boundary == "arn:aws:iam::123456789012:policy/ai-job-apply-development-resume-observer-r7-boundary"
    error_message = "Only the original stopped-task rule may invoke the bounded numeric observer."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.observer[0].policy).Statement[0].Action == ["ecs:DescribeTasks"] && jsondecode(aws_iam_role_policy.observer[0].policy).Statement[3].Effect == "Deny" && contains(jsondecode(aws_iam_role_policy.observer[0].policy).Statement[3].Action, "ecs:StopTask")
    error_message = "Observer must describe original tasks without launch/stop authority."
  }
  assert {
    condition     = aws_iam_role.runtime["control"].permissions_boundary == "arn:aws:iam::123456789012:policy/ai-job-apply-development-resume-control-r7-boundary" && aws_iam_role.runtime["dispatch"].permissions_boundary == local.boundary && aws_iam_role.runtime["durable"].permissions_boundary == local.boundary
    error_message = "Only control uses the original release's separate launch ceiling."
  }
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

run "direct_route_preserves_public_ip_choice" {
  command = plan
  variables {
    release = merge(var.release, { task_assign_public_ip = "ENABLED" })
  }
  assert {
    condition     = jsondecode(aws_lambda_function.control[0].environment[0].variables.NATIVE_RESUME_LAUNCH_CONFIGURATION_JSON).assignPublicIp == "ENABLED" && aws_cloudwatch_event_rule.dispatch[0].state == "DISABLED"
    error_message = "The reviewed direct-route choice must reach the launcher without activating work."
  }
}
run "unknown_network_mode_refused" {
  command = plan
  variables {
    release = merge(var.release, { task_assign_public_ip = "AUTO" })
  }
  expect_failures = [var.release]
}

run "observation_can_continue_without_launch" {
  command = plan
  variables {
    enabled                    = true
    observation_events_enabled = true
  }
  assert {
    condition     = aws_cloudwatch_event_rule.observer[0].state == "ENABLED" && aws_cloudwatch_event_rule.dispatch[0].state == "DISABLED" && aws_lambda_function.control[0].environment[0].variables.NATIVE_RESUME_NEW_LAUNCH_ENABLED == "false"
    error_message = "Original task observation must remain independent of new launches."
  }
}
run "observation_requires_runtime" {
  command = plan
  variables { observation_events_enabled = true }
  expect_failures = [var.observation_events_enabled]
}
