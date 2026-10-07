mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { region = "us-east-2" } }
  mock_resource "aws_lambda_function" { defaults = { version = "9", qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-launch-r1:9" } }
}
variables {
  account_id  = "123456789012"
  environment = "development"
  release     = { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "ai-job-apply-development-artifacts-synthetic", "artifacts" : { "launch" : { "key" : "lambda/documents/native-material/control/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-material-launch-lambda.zip", "version_id" : "synthetic-version", "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=" }, "owner" : { "key" : "lambda/documents/native-material/control/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-owner-rpc-lambda.zip", "version_id" : "synthetic-version", "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=" }, "event" : { "key" : "lambda/documents/native-material/control/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-material-task-event-lambda.zip", "version_id" : "synthetic-version", "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=" } }, "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-4234-8234-123456789012", "extension_layer_arn" : "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114", "subnet_ids" : ["subnet-0123456789abcdef0"], "security_group_ids" : ["sg-0123456789abcdef0"], "cluster_arn" : "arn:aws:ecs:us-east-2:123456789012:cluster/ai-job-apply-development-native", "task_definition_arn" : "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7", "image_repository" : "ai-job-apply/native-material", "image_sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "task_subnet_ids" : ["subnet-0123456789abcdef0"], "task_security_group_ids" : ["sg-0123456789abcdef0"] }
}
run "absent" {
  command = plan
  variables { release = null }
  assert {
    condition     = length(aws_lambda_function.launch) == 0 && length(aws_lambda_function.owner) == 0 && length(aws_lambda_function.event) == 0 && length(aws_iam_role.runtime) == 0
    error_message = "Null release must create no functions or actors."
  }
}
run "disabled_original_control" {
  command = apply
  assert {
    condition     = aws_lambda_function.launch[0].environment[0].variables.NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED == "false" && aws_lambda_function.launch[0].environment[0].variables.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED == "false" && aws_lambda_function.owner[0].environment[0].variables.NATIVE_OWNER_RPC_ENABLED == "false" && aws_lambda_function.event[0].environment[0].variables.NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED == "false"
    error_message = "All runtime switches default off."
  }
  assert {
    condition     = aws_cloudwatch_event_rule.task[0].state == "DISABLED" && jsondecode(aws_cloudwatch_event_rule.task[0].event_pattern).detail.taskDefinitionArn == [var.release.task_definition_arn] && aws_cloudwatch_event_target.task[0].arn == aws_lambda_function.event[0].qualified_arn && aws_lambda_permission.task[0].qualifier == aws_lambda_function.event[0].version
    error_message = "Only original task events may reach the numeric handler; default rule remains disabled."
  }
  assert {
    condition     = aws_cloudwatch_event_target.task[0].dead_letter_config[0].arn == output.event_dead_letter_arn && aws_cloudwatch_event_target.task[0].retry_policy[0].maximum_event_age_in_seconds == 86400 && aws_lambda_function_event_invoke_config.task[0].maximum_event_age_in_seconds == 21600 && aws_lambda_function_event_invoke_config.task[0].destination_config[0].on_failure[0].destination == output.event_dead_letter_arn
    error_message = "Both delivery failure paths must retain original work with bounded independent retry budgets."
  }

  assert {
    condition     = length(aws_lambda_function.launch[0].vpc_config) == 1 && length(aws_lambda_function.owner[0].vpc_config) == 1 && length(aws_lambda_function.event[0].vpc_config) == 0 && !contains(keys(aws_lambda_function.event[0].environment[0].variables), "DATABASE_SECRET_ID") && jsondecode(aws_lambda_function.event[0].environment[0].variables.NATIVE_MATERIAL_TASK_EVENT_CONFIGURATION_JSON).functionArn == aws_lambda_function.launch[0].qualified_arn
    error_message = "Only owning DB handlers enter VPC; recovery invokes original numeric launcher without SQL."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.launch[0].policy).Statement[1].Resource == var.release.task_definition_arn && jsondecode(aws_iam_role_policy.launch[0].policy).Statement[3].Resource == [local.task_role, local.execution_role] && jsondecode(aws_iam_role_policy.event[0].policy).Statement[0].Resource == aws_lambda_function.launch[0].qualified_arn && endswith(aws_iam_role.runtime["launch"].permissions_boundary, "material-launch-r1-boundary")
    error_message = "Launcher may use only original task/roles; event handler targets only original numeric control."
  }
  assert {
    condition     = jsondecode(aws_lambda_function.owner[0].environment[0].variables.NATIVE_OWNER_RPC_DEPLOYMENT_JSON).taskRoleArn == local.task_role && local.launch_configuration.assignPublicIp == "DISABLED" && alltrue([for k in ["owner", "event"] : contains(flatten([for s in jsondecode(aws_iam_role_policy.base[k].policy).Statement : s.Action if s.Effect == "Deny"]), "ecs:*")])
    error_message = "Owners bind original task identity and private networking; only launcher may use ECS."
  }
}
run "recovery_without_new_tasks" {
  command = plan
  variables {
    control_enabled  = true
    recovery_enabled = true
  }
  assert {
    condition     = aws_lambda_function.launch[0].environment[0].variables.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED == "false" && aws_lambda_function.event[0].environment[0].variables.NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED == "true"
    error_message = "Original recovery remains possible without new task creation."
  }
}
run "launch_requires_owners_and_recovery" {
  command = plan
  variables { new_launch_enabled = true }
  expect_failures = [var.new_launch_enabled]
}
run "foreign_release_refused" {
  command = plan
  variables { account_id = "111122223333" }
  expect_failures = [var.release]
}
run "missing_release_cannot_activate" {
  command = plan
  variables {
    release       = null
    owner_enabled = true
  }
  expect_failures = [var.release]
}

override_resource {
  target = aws_iam_role.runtime["launch"]
  values = { arn = "arn:aws:iam::123456789012:role/ai-job-apply-development-material-launch-r1" }
}
override_resource {
  target = aws_lambda_function.launch[0]
  values = { version = "9", qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-launch-r1:9" }
}

override_resource {
  target = aws_iam_role.runtime["owner"]
  values = { arn = "arn:aws:iam::123456789012:role/ai-job-apply-development-material-owner-r1" }
}
override_resource {
  target = aws_lambda_function.owner[0]
  values = { version = "9", qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner-r1:9" }
}

override_resource {
  target = aws_iam_role.runtime["event"]
  values = { arn = "arn:aws:iam::123456789012:role/ai-job-apply-development-material-event-r1" }
}
override_resource {
  target = aws_lambda_function.event[0]
  values = { version = "9", qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-event-r1:9" }
}

override_resource {
  target = aws_cloudwatch_event_rule.task[0]
  values = { arn = "arn:aws:events:us-east-2:123456789012:rule/ai-job-apply-development-material-event-r1" }
}
