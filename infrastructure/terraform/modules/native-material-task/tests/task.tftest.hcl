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
    provider_secret_arn          = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-provider-Abc123"
    provider_secret_version_id   = "22345678-1234-1234-1234-123456789012"
    provider_kms_key_arn         = "arn:aws:kms:us-east-2:123456789012:key/22345678-1234-1234-1234-123456789012"
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
      !contains(keys(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0]), "environment") &&
      !contains(keys(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0]), "secrets") &&
      !contains(keys(jsondecode(aws_ecs_task_definition.material[0].container_definitions)[0]), "mountPoints")
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
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[5].Effect == "Deny" &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[3].Condition.StringEquals["secretsmanager:VersionId"] == var.release.provider_secret_version_id &&
      jsondecode(aws_iam_role_policy.task[0].policy).Statement[4].Condition.StringEquals["kms:EncryptionContext:SecretARN"] == var.release.provider_secret_arn &&
      length(jsondecode(aws_iam_role_policy.execution[0].policy).Statement) == 2 &&
      aws_iam_role.task[0].permissions_boundary == "arn:aws:iam::123456789012:policy/ai-job-apply-development-workload-boundary"
    )
    error_message = "Roles must be bounded and restrict access to original RPC recipients and exact TLS secret/version."
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
      provider_secret_arn          = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-provider-Abc123"
      provider_secret_version_id   = "22345678-1234-1234-1234-123456789012"
      provider_kms_key_arn         = "arn:aws:kms:us-east-2:123456789012:key/22345678-1234-1234-1234-123456789012"
      tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      tls_secret_version_id        = "12345678-1234-1234-1234-123456789012"
      tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [aws_ecs_task_definition.material]
}

run "provider_version_required" {
  command = plan
  variables {
    release = {
      image_repository             = "ai-job-apply/native-material"
      image_sha256                 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expected_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7"
      owner_function_arn           = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner:3"
      provider_secret_arn          = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-provider-Abc123"
      provider_secret_version_id   = "AWSCURRENT"
      provider_kms_key_arn         = "arn:aws:kms:us-east-2:123456789012:key/22345678-1234-1234-1234-123456789012"
      tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      tls_secret_version_id        = "12345678-1234-1234-1234-123456789012"
      tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [var.release]
}

run "secrets_must_be_distinct" {
  command = plan
  variables {
    release = {
      image_repository             = "ai-job-apply/native-material"
      image_sha256                 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expected_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7"
      owner_function_arn           = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner:3"
      provider_secret_arn          = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      provider_secret_version_id   = "22345678-1234-1234-1234-123456789012"
      provider_kms_key_arn         = "arn:aws:kms:us-east-2:123456789012:key/22345678-1234-1234-1234-123456789012"
      tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      tls_secret_version_id        = "12345678-1234-1234-1234-123456789012"
      tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [var.release]
}

run "owner_alias_refused" {
  command = plan
  variables {
    release = {
      image_repository             = "ai-job-apply/native-material"
      image_sha256                 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expected_task_definition_arn = "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-material:7"
      owner_function_arn           = "arn:aws:lambda:us-east-2:123456789012:function:ai-job-apply-development-material-owner:live"
      provider_secret_arn          = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-provider-Abc123"
      provider_secret_version_id   = "22345678-1234-1234-1234-123456789012"
      provider_kms_key_arn         = "arn:aws:kms:us-east-2:123456789012:key/22345678-1234-1234-1234-123456789012"
      tls_secret_arn               = "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/native-material-tls-Abc123"
      tls_secret_version_id        = "12345678-1234-1234-1234-123456789012"
      tls_kms_key_arn              = "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [var.release]
}
