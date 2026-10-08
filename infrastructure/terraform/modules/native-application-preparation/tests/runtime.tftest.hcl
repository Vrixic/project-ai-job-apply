mock_provider "aws" {
  mock_resource "aws_cloudwatch_event_rule" { defaults = { arn = "arn:aws:events:us-east-2:123456789012:rule/synthetic-recovery" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { region = "us-east-2" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/synthetic-runtime" } }
  mock_resource "aws_lambda_function" { defaults = { qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-private:1", version = "1" } }
  mock_resource "aws_cloudformation_stack" { defaults = { outputs = { DurableVersionArn = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-prep-durable-r1:2" } } }
}
variables {
  account_id  = "123456789012"
  environment = "development"
  release = {
    "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "release_id" : "r1",
    "artifact_bucket" : "synthetic-artifacts",
    "artifacts" : {
      "activity" : {
        "key" : "lambda/applications/native-preparation/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-application-preparation-lambda.zip",
        "version_id" : "synthetic-version",
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s="
      },
      "durable" : {
        "key" : "lambda/applications/native-preparation/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/application-preparation-durable-lambda.zip",
        "version_id" : "synthetic-version",
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s="
      },
      "starter" : {
        "key" : "lambda/applications/native-preparation/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/application-preparation-starter-lambda.zip",
        "version_id" : "synthetic-version",
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s="
      },
      "recovery" : {
        "key" : "lambda/applications/native-preparation/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/application-preparation-recovery-lambda.zip",
        "version_id" : "synthetic-version",
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s="
      }
    },
    "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/database-Abc123",
    "platform_kms_key_arn" : "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-4234-8234-123456789012",
    "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:123456789012:key/22345678-1234-4234-8234-123456789012",
    "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:123456789012:key/32345678-1234-4234-8234-123456789012",
    "launcher_function_arn" : "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-launch:9",
    "queue_arn" : "arn:aws:sqs:us-east-2:123456789012:ai-job-apply-development-preparation",
    "queue_url" : "https://sqs.us-east-2.amazonaws.com/123456789012/ai-job-apply-development-preparation",
    "queue_kms_key_arn" : "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-4234-8234-123456789012",
    "dead_letter_arn" : "arn:aws:sqs:us-east-2:123456789012:ai-job-apply-development-preparation-dlq",
    "extension_layer_arn" : "arn:aws:lambda:us-east-2:123456789012:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1",
    "subnet_ids" : [
      "subnet-0123456789abcdef0",
      "subnet-0123456789abcdef1"
    ],
    "security_group_ids" : [
      "sg-0123456789abcdef0"
    ]
  }
}
run "absent" {
  command = plan
  variables { release = null }
  assert {
    condition     = length(aws_lambda_function.runtime) == 0 && length(aws_lambda_function.activity) == 0 && length(aws_iam_role.runtime) == 0 && length(aws_cloudformation_stack.durable) == 0
    error_message = "Absent release must create nothing."
  }
}
run "disabled_connected" {
  command = apply
  assert {
    condition     = alltrue([for role in aws_iam_role.runtime : role.permissions_boundary == "arn:aws:iam::123456789012:policy/ai-job-apply-development-prep-runtime-r1-boundary"])
    error_message = "Every actor must use the exact original release boundary owned by bootstrap."
  }

  assert {
    condition     = !aws_lambda_event_source_mapping.intake[0].enabled && alltrue([for r in aws_cloudwatch_event_rule.recovery : r.state == "DISABLED"])
    error_message = "All triggers must default off."
  }
  assert {
    condition     = aws_lambda_function.activity[0].environment[0].variables.NATIVE_APPLICATION_PREPARATION_ENABLED == "false" && aws_lambda_function.runtime["starter"].environment[0].variables.APPLICATION_PREPARATION_STARTER_ENABLED == "false" && aws_lambda_function.runtime["terminal"].environment[0].variables.APPLICATION_PREPARATION_RECOVERY_ENABLED == "false"
    error_message = "Deploying cannot activate runtimes."
  }
  assert {
    condition     = jsondecode(aws_cloudformation_stack.durable[0].template_body).Resources.DurableFunction.Properties.Environment.Variables.APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN == aws_lambda_function.activity[0].qualified_arn && aws_lambda_event_source_mapping.intake[0].function_name == aws_lambda_function.runtime["starter"].qualified_arn
    error_message = "Calls and intake must target numeric versions."
  }
  assert {
    condition     = aws_lambda_function.runtime["terminal"].handler == "index.terminalHandler" && aws_lambda_function.runtime["reconcile"].handler == "index.reconcileHandler" && !contains(keys(aws_lambda_function.runtime["terminal"].environment[0].variables), "APPLICATION_PREPARATION_QUEUE_URL")
    error_message = "Terminal recovery must not receive scheduled-only configuration."
  }
  assert {
    condition     = alltrue([for p in aws_iam_role_policy.recovery : anytrue([for s in jsondecode(p.policy).Statement : s.Effect == "Deny" && contains(s.Action, "lambda:InvokeFunction")])]) && jsondecode(aws_iam_role_policy.activity[0].policy).Statement[0].Resource == var.release.launcher_function_arn
    error_message = "Recovery cannot invoke work; activity invokes only its original launcher."
  }
  assert {
    condition     = jsondecode(aws_cloudformation_stack.durable[0].template_body).Resources.DurableFunction.Properties.DurableConfig.ExecutionTimeout == 900 && length(jsondecode(aws_iam_role_policy.durable[0].policy).Statement) == 3
    error_message = "Legacy preparation must retain its timeout and receive no routing authority."
  }
}
run "recovery_without_intake" {
  command = apply
  variables {
    recovery_enabled  = true
    retained_versions = ["1"]
  }
  assert {
    condition     = !aws_lambda_event_source_mapping.intake[0].enabled && alltrue([for r in aws_cloudwatch_event_rule.recovery : r.state == "ENABLED"]) && aws_lambda_function.runtime["reconcile"].environment[0].variables.APPLICATION_PREPARATION_NUDGES_ENABLED == "false"
    error_message = "Recovery must continue while new work stays disabled."
  }
  assert {
    condition     = length(jsondecode(aws_lambda_function.runtime["starter"].environment[0].variables.APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS)) == 2 && alltrue([for arn in jsondecode(aws_iam_role_policy.recovery["terminal"].policy).Statement[0].Resource : endswith(arn, "/durable-execution/*")])
    error_message = "Retain exact original versions and metadata-only execution resources."
  }
}
run "intake_requires_recovery" {
  command = plan
  variables {
    enabled        = true
    launch_enabled = true
    intake_enabled = true
  }
  expect_failures = [var.intake_enabled]
}
run "aliases_rejected" {
  command = plan
  variables { retained_versions = ["live"] }
  expect_failures = [var.retained_versions]
}
run "missing_release_rejected" {
  command = plan
  variables {
    release          = null
    recovery_enabled = true
  }
  expect_failures = [var.release]
}

run "enabled_configuration" {
  command = apply
  variables {
    enabled          = true
    launch_enabled   = true
    intake_enabled   = true
    recovery_enabled = true
  }
  assert {
    condition     = aws_lambda_event_source_mapping.intake[0].enabled && aws_lambda_function.runtime["reconcile"].environment[0].variables.APPLICATION_PREPARATION_NUDGES_ENABLED == "true" && aws_lambda_function.activity[0].environment[0].variables.NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED == "true"
    error_message = "Reviewed activation must wire the launch, intake and nudge flags together."
  }
  assert {
    condition     = aws_lambda_function_event_invoke_config.recovery["terminal"].maximum_event_age_in_seconds == 21600 && aws_cloudwatch_event_target.recovery["terminal"].retry_policy[0].maximum_event_age_in_seconds == 86400
    error_message = "Lambda and EventBridge must retain their distinct supported retry windows."
  }
}

run "bound_work_drain" {
  command = apply
  variables {
    recovery_enabled  = true
    drain_enabled     = true
    retained_versions = ["1"]
  }
  assert {
    condition     = aws_lambda_event_source_mapping.intake[0].enabled && aws_lambda_function.runtime["starter"].environment[0].variables.APPLICATION_PREPARATION_STARTER_ENABLED == "true" && aws_lambda_function.runtime["starter"].environment[0].variables.APPLICATION_PREPARATION_INTAKE_ENABLED == "false" && aws_lambda_function.runtime["reconcile"].environment[0].variables.APPLICATION_PREPARATION_NUDGES_ENABLED == "true" && aws_lambda_function.runtime["reconcile"].environment[0].variables.APPLICATION_PREPARATION_INTAKE_ENABLED == "false"
    error_message = "Drain must retry original work while refusing unbound intake."
  }
}

run "route_configured_disabled" {
  command = apply
  variables { route = { hosted_zone_id = "ZSYNTHETIC", base_host = "materials.example.com" } }
  assert {
    condition     = jsondecode(aws_cloudformation_stack.durable[0].template_body).Resources.DurableFunction.Properties.DurableConfig.ExecutionTimeout == 3600 && local.durable_environment.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED == "false" && local.durable_environment.NATIVE_MATERIAL_ROUTE_CREATION_ENABLED == "false"
    error_message = "Retained routing needs the full cleanup window without activating runtime."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.durable[0].policy).Statement : s.Resource if try(s.Sid, "") == "OriginalRouteControl"]) == var.release.launcher_function_arn && local.durable_environment.NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN == var.release.launcher_function_arn
    error_message = "Orchestration must use only the original numeric route control."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.durable[0].policy).Statement : s.Resource == "arn:aws:route53:::hostedzone/ZSYNTHETIC" if contains(s.Action, "route53:ChangeResourceRecordSets") || contains(s.Action, "route53:ListResourceRecordSets")]) && one([for s in jsondecode(aws_iam_role_policy.durable[0].policy).Statement : s.Condition["ForAllValues:StringLike"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"] if try(s.Sid, "") == "OriginalRecords"])[0] == "????????-????-7???-????-????????????.materials.example.com"
    error_message = "DNS authority must stay within the original zone and allocation hostname."
  }
  assert {
    condition     = toset(one([for s in jsondecode(aws_iam_role_policy.durable[0].policy).Statement : s.Condition["ForAllValues:StringEquals"]["route53:ChangeResourceRecordSetsActions"] if try(s.Sid, "") == "OriginalRecords"])) == toset(["CREATE", "DELETE"]) && one([for s in jsondecode(aws_iam_role_policy.durable[0].policy).Statement : s.Condition["ForAllValues:StringEquals"]["route53:ChangeResourceRecordSetsRecordTypes"] if try(s.Sid, "") == "OriginalRecords"])[0] == "A"
    error_message = "DNS changes must allow only A-record creation/deletion, never UPSERT."
  }
  assert {
    condition     = alltrue([for kind, role in aws_iam_role.runtime : role.permissions_boundary == "arn:aws:iam::123456789012:policy/ai-job-apply-development-prep-${kind == "durable" ? "durable" : "runtime"}-r1-boundary"])
    error_message = "Only routed durable actor may use the separate routing ceiling."
  }
}
run "route_enabled" {
  command = apply
  variables {
    route                  = { hosted_zone_id = "ZSYNTHETIC", base_host = "materials.example.com" }
    enabled                = true
    launch_enabled         = true
    recovery_enabled       = true
    intake_enabled         = true
    route_enabled          = true
    route_creation_enabled = true
  }
  assert {
    condition     = local.activity_environment.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED == "true" && local.durable_environment.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED == "true" && local.durable_environment.NATIVE_MATERIAL_ROUTE_CREATION_ENABLED == "true" && aws_lambda_event_source_mapping.intake[0].enabled
    error_message = "Reviewed routed intake must stage and attach through the same mode."
  }
}
run "route_cleanup_without_creation" {
  command = apply
  variables {
    route            = { hosted_zone_id = "ZSYNTHETIC", base_host = "materials.example.com" }
    enabled          = true
    recovery_enabled = true
    drain_enabled    = true
    route_enabled    = true
  }
  assert {
    condition     = local.durable_environment.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED == "true" && local.durable_environment.NATIVE_MATERIAL_ROUTE_CREATION_ENABLED == "false" && !var.intake_enabled && aws_lambda_event_source_mapping.intake[0].enabled && length(jsondecode(aws_iam_role_policy.durable[0].policy).Statement) == 7
    error_message = "Stopping creation must preserve cleanup permissions and original bound-work drain."
  }
}
run "route_required_for_activation" {
  command = plan
  variables {
    enabled       = true
    route_enabled = true
  }
  expect_failures = [var.route_enabled]
}
run "route_creation_requires_lifecycle" {
  command = plan
  variables { route_creation_enabled = true }
  expect_failures = [var.route_creation_enabled]
}
run "routed_intake_requires_creation" {
  command = plan
  variables {
    route            = { hosted_zone_id = "ZSYNTHETIC", base_host = "materials.example.com" }
    enabled          = true
    launch_enabled   = true
    recovery_enabled = true
    intake_enabled   = true
    route_enabled    = true
  }
  expect_failures = [var.intake_enabled]
}
run "route_hostname_rejected" {
  command = plan
  variables { route = { hosted_zone_id = "ZSYNTHETIC", base_host = "*.materials.example.com" } }
  expect_failures = [var.route]
}

run "retained_original_activity_access" {
  command = apply
  variables { retained_activity_versions = ["7", "8"] }
  assert {
    condition     = toset(one([for s in jsondecode(aws_iam_role_policy.durable[0].policy).Statement : s.Resource if contains(s.Action, "lambda:InvokeFunction")])) == toset([aws_lambda_function.activity[0].qualified_arn, "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-prep-activity-r1:7", "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-prep-activity-r1:8"])
    error_message = "Retained workflows must keep invoking only their exact original numeric activities."
  }
}
run "retained_activity_alias_rejected" {
  command = plan
  variables { retained_activity_versions = ["live"] }
  expect_failures = [var.retained_activity_versions]
}
