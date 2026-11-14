override_resource {
  target = aws_iam_role.execution[0]
  values = { arn = "arn:aws:iam::123456789012:role/ai-job-apply-development-native-material-r7-execution" }
}
override_resource {
  target = aws_iam_role.task[0]
  values = { arn = "arn:aws:iam::123456789012:role/ai-job-apply-development-native-material-r7-task" }
}
mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { region = "us-east-2" } }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7" }
  }
}
variables {
  account_id  = "123456789012"
  environment = "development"
  release = {
    image_repository             = "ai-job-apply/native-material"
    image_sha256                 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expected_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7"
    owner_function_arn           = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner:3"
    tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
    tls_secret_version_id        = "12345678-1234-1234-1234-123456789012"
    tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
  }
}
run "default_has_no_resources" {
  command = plan
  variables { release = null }
  assert {
    condition     = length(aws_ecs_task_definition.material) == 0 && length(aws_iam_role.task) == 0 && length(aws_iam_role.execution) == 0 && length(aws_iam_role_policy.task) == 0 && length(aws_iam_role_policy.execution) == 0
    error_message = "No role, policy or task definition may exist without an exact release."
  }
}
run "exact_release_has_bounded_task_and_roles" {
  command = apply
  assert {
    condition = (
      aws_ecs_task_definition.material[0].cpu == "256" && aws_ecs_task_definition.material[0].memory == "512" &&
      aws_ecs_task_definition.material[0].network_mode == "awsvpc" &&
      aws_ecs_task_definition.material[0].runtime_platform[0].operating_system_family == "LINUX" &&
      aws_ecs_task_definition.material[0].runtime_platform[0].cpu_architecture == "X86_64" &&
      jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].linuxParameters.initProcessEnabled &&
      jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].readonlyRootFilesystem &&
      jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].user == "65532:65532" &&
      jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].image == output.image &&
      length(jsondecode(aws_ecs_task_definition.material[0].container_definitions)) == 1 &&
      !contains(keys(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0]), "logConfiguration") &&
      length(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].environment) == 0 &&
      !contains(keys(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0]), "secrets") &&
      length(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].mountPoints) == 0 &&
      length(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].volumesFrom) == 0 &&
      length(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].systemControls) == 0 &&
      length(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].linuxParameters.capabilities.add) == 0 &&
      jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0].linuxParameters.capabilities.drop == ["ALL"]
    )
    error_message = "Native task envelope must preserve init, isolated memory, immutable image and no candidate-bearing side channels."
  }
  assert {
    condition = (
      jsondecode(aws_iam_role.task[0].assume_role_policy).Statement[0].Principal.Service == "ecs-tasks.amazonaws.com" &&
      jsondecode(aws_iam_role.task[0].assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == var.account_id &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[0].Resource == [var.release.owner_function_arn] &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[1].Condition.StringEquals["secretsmanager:VersionId"] == var.release.tls_secret_version_id &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[2].Condition.StringEquals["kms:EncryptionContext:SecretARN"] == var.release.tls_secret_arn &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[3].Effect == "Deny" &&
      length(jsondecode(aws_iam_role_policy.task[0].policy).Statement) == 4 &&
      length(jsondecode(aws_iam_role_policy.execution[0].policy).Statement) == 2 &&
      aws_iam_role.task[0].permissions_boundary == "arn:aws:iam::123456789012:policy/ai-job-apply-development-workload-boundary"
    )
    error_message = "Roles must be bounded and restrict access to original RPC recipients and exact TLS secret/version. There is no provider secret (ADR-059 addendum 12)."
  }
}
run "foreign_account_refused" {
  command = plan
  variables { account_id = "111122223333" }
  expect_failures = [var.release]
}
run "wrong_environment_refused" {
  command = plan
  variables { environment = "staging" }
  expect_failures = [var.release]
}
run "unexpected_registered_revision_refused" {
  command = plan
  variables {
    release = {
      image_repository             = "ai-job-apply/native-material"
      image_sha256                 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expected_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:8"
      owner_function_arn           = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner:3"
      tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      tls_secret_version_id        = "12345678-1234-1234-1234-123456789012"
      tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [aws_ecs_task_definition.material]
}

run "tls_version_required" {
  command = plan
  variables {
    release = {
      image_repository             = "ai-job-apply/native-material"
      image_sha256                 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expected_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7"
      owner_function_arn           = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner:3"
      tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      tls_secret_version_id        = "AWSCURRENT"
      tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [var.release]
}

run "provider_secret_not_granted" {
  command = plan
  assert {
    condition     = !strcontains(aws_iam_role_policy.task[0].policy, "provider") && !strcontains(aws_iam_role_policy.task[0].policy, "Provider")
    error_message = "The cover-letter task holds no provider secret or key; the model is reached with the task role."
  }
}

run "owner_alias_refused" {
  command = plan
  variables {
    release = {
      image_repository             = "ai-job-apply/native-material"
      image_sha256                 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expected_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7"
      owner_function_arn           = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner:live"
      tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      tls_secret_version_id        = "12345678-1234-1234-1234-123456789012"
      tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [var.release]
}

run "live_generation_absent_by_default" {
  command = plan
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.task[0].policy).Statement) == 4 && !strcontains(aws_iam_role_policy.task[0].policy, "bedrock") && length(output.live_generation_invoke_resources) == 0
    error_message = "Without live generation the task role must hold no Bedrock permission and keep its original four statements."
  }
}
run "live_generation_off_grants_nothing" {
  command = plan
  variables {
    live_generation = {
      enabled               = false
      profile_arn           = "arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6"
      foundation_model_arns = ["arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6"]
    }
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.task[0].policy).Statement) == 4 && !strcontains(aws_iam_role_policy.task[0].policy, "bedrock")
    error_message = "The kill switch off must remove the model permission without changing anything else."
  }
}
run "live_generation_on_grants_only_the_reviewed_profile_and_models" {
  command = plan
  variables {
    live_generation = {
      enabled     = true
      profile_arn = "arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6"
      foundation_model_arns = [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6"
      ]
    }
  }
  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.task[0].policy).Statement) == 6 &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[0].Resource == [var.release.owner_function_arn] &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[3].Effect == "Deny" &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[4] == {
        Sid      = "InvokeReviewedProfile", Effect = "Allow", Action = ["bedrock:InvokeModel"],
        Resource = ["arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6"]
      } &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[5] == {
        Sid = "InvokeReviewedFoundationModels", Effect = "Allow", Action = ["bedrock:InvokeModel"],
        Resource = [
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6",
          "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6",
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6"
        ]
      } &&
      !strcontains(aws_iam_role_policy.task[0].policy, "bedrock:*") && !strcontains(aws_iam_role_policy.task[0].policy, "InvokeModelWith")
    )
    error_message = "When on, the role may only InvokeModel (Converse) on the one reviewed profile and its foundation models; the original statements and the content-persistence Deny are unchanged."
  }
}
run "live_generation_foreign_account_profile_refused" {
  command = plan
  variables {
    live_generation = {
      enabled               = true
      profile_arn           = "arn:aws:bedrock:us-east-2:999900001111:inference-profile/us.anthropic.claude-sonnet-4-6"
      foundation_model_arns = ["arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6"]
    }
  }
  expect_failures = [var.live_generation]
}
run "live_generation_wildcard_model_refused" {
  command = plan
  variables {
    live_generation = {
      enabled               = true
      profile_arn           = "arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6"
      foundation_model_arns = ["arn:aws:bedrock:us-east-2::foundation-model/*"]
    }
  }
  expect_failures = [var.live_generation]
}
run "live_generation_non_us_model_refused" {
  command = plan
  variables {
    live_generation = {
      enabled               = true
      profile_arn           = "arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6"
      foundation_model_arns = ["arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-sonnet-4-6"]
    }
  }
  expect_failures = [var.live_generation]
}
