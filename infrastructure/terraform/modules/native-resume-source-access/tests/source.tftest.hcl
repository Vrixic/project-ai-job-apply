mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { region = "us-east-2" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/synthetic-rpc" } }
  mock_resource "aws_lambda_function" { defaults = { qualified_arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic:1" } }
}
variables {
  account_id  = "123456789012"
  environment = "development"
  release = {
    "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "artifact_bucket" : "synthetic-artifacts",
    "artifacts" : {
      "owner" : {
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=",
        "version_id" : "synthetic-version",
        "key" : "lambda/documents/native-resume/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-resume-owner-rpc-lambda.zip"
      },
      "source" : {
        "sha256" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "base64sha256" : "u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s=",
        "version_id" : "synthetic-version",
        "key" : "lambda/documents/native-resume/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/native-resume-source-rpc-lambda.zip"
      }
    },
    "cluster_arn" : "arn:aws:ecs:us-east-2:123456789012:cluster/native-resume",
    "task_definition_arn" : "arn:aws:ecs:us-east-2:123456789012:task-definition/ai-job-apply-development-native-resume:7",
    "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/database-Abc123",
    "platform_kms_key_arn" : "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012",
    "normalized_bucket" : "synthetic-documents",
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
run "absent_by_default" {
  command = plan
  variables { release = null }
  assert {
    condition     = length(aws_lambda_function.rpc) == 0 && length(aws_iam_role.rpc) == 0 && length(aws_iam_role_policy.rpc) == 0
    error_message = "No private infrastructure may exist without a reviewed release."
  }
}
run "private_pair_is_off_and_version_bound" {
  command = apply
  assert {
    condition = (
      length(aws_lambda_function.rpc) == 2 &&
      aws_lambda_function.rpc["owner"].environment[0].variables.NATIVE_RESUME_OWNER_RPC_ENABLED == "false" &&
      aws_lambda_function.rpc["source"].environment[0].variables.NATIVE_RESUME_SOURCE_RPC_ENABLED == "false" &&
      aws_lambda_function.rpc["source"].s3_object_version == "synthetic-version" &&
      aws_lambda_function.rpc["source"].publish &&
      aws_lambda_function.rpc["owner"].layers[0] == var.release.extension_layer_arn &&
      jsondecode(aws_lambda_function.rpc["source"].environment[0].variables.NATIVE_RESUME_SOURCE_RPC_DEPLOYMENT_JSON).taskRoleArn == "arn:aws:iam::123456789012:role/ai-job-apply-development-native-resume-r7-task" &&
      !contains(keys(aws_lambda_function.rpc["owner"].environment[0].variables), "NATIVE_RESUME_SOURCE_BUCKET") &&
      !contains(keys(aws_lambda_function.rpc["source"].environment[0].variables), "DATABASE_URL")
    )
    error_message = "Private handlers must stay disabled and preserve exact artifact, task and capability bindings."
  }
  assert {
    condition = (
      jsondecode(aws_iam_role_policy.rpc["owner"].policy).Statement[5].Action == ["s3:*"] &&
      jsondecode(aws_iam_role_policy.rpc["owner"].policy).Statement[5].Effect == "Deny" &&
      jsondecode(aws_iam_role_policy.rpc["source"].policy).Statement[5].Action == ["s3:GetObjectVersion"] &&
      jsondecode(aws_iam_role_policy.rpc["source"].policy).Statement[5].Resource == "arn:aws:s3:::synthetic-documents/normalized/*/*/*/resume.json" &&
      jsondecode(aws_iam_role_policy.rpc["source"].policy).Statement[4].Effect == "Deny"
    )
    error_message = "Only source RPC may read retained normalized object versions; neither handler may launch or write artifacts."
  }
}
run "activation_is_separate" {
  command = plan
  variables { enabled = true }
  assert {
    condition     = aws_lambda_function.rpc["owner"].environment[0].variables.NATIVE_RESUME_OWNER_RPC_ENABLED == "true" && aws_lambda_function.rpc["source"].environment[0].variables.NATIVE_RESUME_SOURCE_RPC_ENABLED == "true"
    error_message = "An explicit runtime gate must configure both exact private recipients."
  }
}
run "foreign_target_refused" {
  command = plan
  variables { account_id = "111122223333" }
  expect_failures = [var.release]
}
run "activation_without_release_refused" {
  command = plan
  variables {
    release = null
    enabled = true
  }
  expect_failures = [var.release]
}
