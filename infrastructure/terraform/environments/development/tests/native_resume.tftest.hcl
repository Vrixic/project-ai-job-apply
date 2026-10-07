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

run "native_releases_default_empty" {
  command = plan
  assert {
    condition     = length(module.native_resume_source_access) == 0 && length(module.native_resume_task) == 0 && length(module.native_resume_preparation) == 0
    error_message = "Existing environment defaults must not create native resume resources."
  }
}
run "explicit_source_release_is_forwarded" {
  command = plan
  variables {
    native_resume_source_access_releases = {
      original7 = {
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
          "cluster_arn" : "arn:aws:ecs:us-east-2:111122223333:cluster/native-resume",
          "task_definition_arn" : "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-resume:7",
          "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123",
          "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-111122223333",
          "normalized_bucket" : "synthetic-documents",
          "extension_layer_arn" : "arn:aws:lambda:us-east-2:111122223333:layer:AWS-Parameters-and-Secrets-Lambda-Extension:1",
          "subnet_ids" : [
            "subnet-0123456789abcdef0",
            "subnet-0123456789abcdef1"
          ],
          "security_group_ids" : [
            "sg-0123456789abcdef0"
          ]
        }
      }
    }
  }
  assert {
    condition     = module.native_resume_source_access["original7"].task_binding.taskDefinitionArn == var.native_resume_source_access_releases.original7.release.task_definition_arn && length(module.native_resume_task) == 0 && length(module.native_resume_preparation) == 0
    error_message = "Source publication must preserve its original binding without also creating task or workflow releases."
  }
}

run "explicit_task_and_preparation_bindings" {
  command = plan
  variables {
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
  assert {
    condition     = module.native_resume_preparation["original7"].launch_configuration.image == module.native_resume_task["original7"].image && module.native_resume_preparation["original7"].launch_configuration.taskDefinitionArn == var.native_resume_task_releases.original7.release.expected_task_definition_arn && module.native_resume_preparation["original7"].launch_configuration.assignPublicIp == "DISABLED" && length(module.native_resume_source_access) == 0
    error_message = "Explicit runtime releases must preserve the reviewed image/task/network inputs without recreating source functions."
  }
}
