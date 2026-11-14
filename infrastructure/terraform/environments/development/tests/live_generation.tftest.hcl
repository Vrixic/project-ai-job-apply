mock_provider "aws" {
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
      arn = "arn:aws:iam::111122223333:policy/ai-job-apply-staging-workload-boundary"
    }
  }

  mock_data "aws_prefix_list" {
    defaults = { id = "pl-s3gateway" }
  }

  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }

  mock_resource "aws_cloudformation_stack" {
    defaults = {
      outputs = {
        DurableAliasArn   = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:staging"
        DurableVersionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:1"
      }
    }
  }

  mock_resource "aws_lambda_function" {
    defaults = {
      version       = "1"
      qualified_arn = "arn:aws:lambda:us-east-2:111122223333:function:mock:1"
    }
  }

  mock_resource "aws_lambda_alias" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-2:111122223333:function:mock:staging"
      invoke_arn = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:111122223333:function:mock:staging/invocations"
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


mock_provider "aws" { alias = "billing" }

variables {
  development_database_mode = "retained"
  native_resume_task_releases = { original7 = { release = {
    "image_repository" : "ai-job-apply/native-resume",
    "image_sha256" : "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "expected_task_definition_arn" : "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-resume:7",
    "owner_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-owner-r7:1",
    "source_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-resume-source-r7:1",
    "tls_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/native-resume-tls-Abc123",
    "tls_secret_version_id" : "12345678-1234-1234-1234-123456789012",
    "tls_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-111122223333"
  } } }
  native_resume_preparation_releases = { original7 = { release = {
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
    "cluster_arn" : "arn:aws:ecs:us-east-2:111122223333:cluster/native-resume",
    "task_definition_arn" : "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-resume:7",
    "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123",
    "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-111122223333",
    "extension_layer_arn" : "arn:aws:lambda:us-east-2:111122223333:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1",
    "subnet_ids" : [
      "subnet-0123456789abcdef0",
      "subnet-0123456789abcdef1"
    ],
    "security_group_ids" : [
      "sg-0123456789abcdef0"
    ],
    "observer_dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-resume-observation-dlq",
    "image" : "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/native-resume@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "task_assign_public_ip" : "DISABLED",
    "task_subnet_ids" : [
      "subnet-0123456789abcdef0",
      "subnet-0123456789abcdef1"
    ],
    "task_security_group_ids" : [
      "sg-0123456789abcdef0"
    ]
  } } }
}

run "live_generation_absent_by_default" {
  command = plan
  assert {
    condition = (
      output.live_generation_bindings == null &&
      module.platform.live_generation_profile_arn == null &&
      length(module.platform.live_generation_foundation_model_arns) == 0 &&
      module.cost_controls.live_generation_budget_name == null &&
      length(module.native_resume_task["original7"].live_generation_invoke_resources) == 0
    )
    error_message = "Without the live_generation variable nothing about live generation may exist or be granted."
  }
}

run "kill_switch_on_grants_the_task_role_the_exact_reviewed_model" {
  command = plan
  variables {
    live_generation = {
      model           = "us.anthropic.claude-sonnet-4-6"
      enabled         = true
      budget_services = ["Claude Sonnet 4.6 (Amazon Bedrock Edition)"]
    }
  }
  assert {
    condition = (
      module.platform.live_generation_profile_arn == "arn:aws:bedrock:us-east-2:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6" &&
      jsonencode(module.native_resume_task["original7"].live_generation_invoke_resources) == jsonencode([
        "arn:aws:bedrock:us-east-2:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6"
      ]) &&
      output.live_generation_bindings.enabled &&
      module.cost_controls.live_generation_budget_name == "ai-job-apply-development-live-generation"
    )
    error_message = "With the kill switch on, the native resume task role may invoke only the reviewed profile and its foundation models, and the budget exists."
  }
}

run "kill_switch_off_removes_the_permission_but_keeps_the_endpoint_and_budget" {
  command = plan
  variables {
    live_generation = {
      model           = "us.anthropic.claude-sonnet-4-6"
      enabled         = false
      budget_services = ["Claude Sonnet 4.6 (Amazon Bedrock Edition)"]
    }
  }
  assert {
    condition = (
      length(module.native_resume_task["original7"].live_generation_invoke_resources) == 0 &&
      !output.live_generation_bindings.enabled &&
      module.platform.live_generation_profile_arn != null &&
      module.cost_controls.live_generation_budget_name == "ai-job-apply-development-live-generation"
    )
    error_message = "The kill switch must remove only the permission; turning it off must not need the endpoint or the budget to change."
  }
}

run "cover_letter_task_gets_the_same_switch_and_no_provider_secret" {
  command = plan
  variables {
    live_generation = {
      model           = "us.anthropic.claude-sonnet-4-6"
      enabled         = true
      budget_services = ["Claude Sonnet 4.6 (Amazon Bedrock Edition)"]
    }
    native_material_task_releases = { r3 = {
      "image_repository" : "ai-job-apply/native-material",
      "image_sha256" : "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "expected_task_definition_arn" : "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:3",
      "owner_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:9",
      "tls_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/native-material-tls-Abc123",
      "tls_secret_version_id" : "12345678-1234-1234-1234-123456789012",
      "tls_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-111122223333"
    } }
  }
  assert {
    condition = (
      jsonencode(module.native_material_task["r3"].live_generation_invoke_resources) == jsonencode(module.native_resume_task["original7"].live_generation_invoke_resources) &&
      length(module.native_material_task["r3"].live_generation_invoke_resources) == 4
    )
    error_message = "With the kill switch on, the cover-letter task role may invoke exactly what the native resume task role may: the reviewed profile and its foundation models."
  }
}

run "kill_switch_off_removes_the_cover_letter_permission_too" {
  command = plan
  variables {
    live_generation = {
      model           = "us.anthropic.claude-sonnet-4-6"
      enabled         = false
      budget_services = ["Claude Sonnet 4.6 (Amazon Bedrock Edition)"]
    }
    native_material_task_releases = { r3 = {
      "image_repository" : "ai-job-apply/native-material",
      "image_sha256" : "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "expected_task_definition_arn" : "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:3",
      "owner_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:9",
      "tls_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/native-material-tls-Abc123",
      "tls_secret_version_id" : "12345678-1234-1234-1234-123456789012",
      "tls_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-111122223333"
    } }
  }
  assert {
    condition     = length(module.native_material_task["r3"].live_generation_invoke_resources) == 0
    error_message = "The kill switch must remove the cover-letter task role's model permission without a release."
  }
}

run "unreviewed_model_refused" {
  command = plan
  variables {
    live_generation = {
      model           = "us.anthropic.claude-fable-5"
      budget_services = ["Claude Fable 5 (Amazon Bedrock Edition)"]
    }
  }
  expect_failures = [var.live_generation]
}
