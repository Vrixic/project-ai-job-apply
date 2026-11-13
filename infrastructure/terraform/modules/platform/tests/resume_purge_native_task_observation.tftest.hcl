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

variables {
  name        = "ai-job-apply"
  environment = "staging"
  vpc_cidr    = "10.30.0.0/16"

  oidc_issuer                               = "https://example.auth0.com/"
  oidc_audience                             = "https://api.example.invalid"
  deploy_applications                       = true
  deploy_gateway_lambda                     = true
  gateway_lambda_artifact_s3_key            = "lambda/gateway.zip"
  gateway_lambda_artifact_s3_object_version = "gateway-version"
  gateway_lambda_artifact_sha256            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  gateway_lambda_artifact_base64sha256      = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
  gateway_lambda_extension_layer_arn        = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"

  deploy_serverless_outbox                              = true
  workflow_ingress_artifact_s3_key                      = "lambda/workflow-ingress.zip"
  workflow_ingress_artifact_s3_object_version           = "ingress-version"
  workflow_ingress_artifact_sha256                      = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  workflow_ingress_artifact_base64sha256                = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI="
  workflow_ingress_lambda_extension_layer_arn           = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  deploy_profile_readiness_durable                      = true
  profile_readiness_durable_artifact_s3_key             = "lambda/profile/durable.zip"
  profile_readiness_durable_artifact_s3_object_version  = "durable-version"
  profile_readiness_durable_artifact_sha256             = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  profile_readiness_durable_artifact_base64sha256       = "Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2M="
  profile_readiness_activity_artifact_s3_key            = "lambda/profile/activity.zip"
  profile_readiness_activity_artifact_s3_object_version = "activity-version"
  profile_readiness_activity_artifact_sha256            = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  profile_readiness_activity_artifact_base64sha256      = "ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGQ="
  profile_readiness_lambda_extension_layer_arn          = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  ingestion_durable_artifact_s3_key                     = "lambda/ingestion/durable.zip"
  ingestion_durable_artifact_s3_object_version          = "ingestion-durable-version"
  ingestion_durable_artifact_sha256                     = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  ingestion_durable_artifact_base64sha256               = "ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWU="
  ingestion_runtime_artifact_s3_key                     = "lambda/ingestion/runtime.zip"
  ingestion_runtime_artifact_s3_object_version          = "ingestion-runtime-version"
  ingestion_runtime_artifact_sha256                     = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  ingestion_runtime_artifact_base64sha256               = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="
  ingestion_lambda_extension_layer_arn                  = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  candidate_rights_auth0_secret_provisioned             = true
  candidate_rights_auth0_authorized_owner               = "authorized-operator"
  candidate_rights_id_token_audience                    = "candidate-web-client"
  deploy_document_intake                                = true
  serverless_runtime_enabled                            = true
  private_application_networking                        = true
  candidate_rights_enabled                              = true
  candidate_rights_policy_version                       = "d3-development-synthetic-v1"
  candidate_rights_policy_sha256                        = "9999999999999999999999999999999999999999999999999999999999999999"
  candidate_rights_owner_inventory                      = "identity,profile,documents,jobs,matching,billing,trust,applications"
  candidate_rights_subprocessor_inventory               = "none"
  candidate_rights_export_lifetime_seconds              = 3600
  candidate_rights_download_grant_seconds               = 300
  candidate_rights_backup_retention_days                = 7
  candidate_rights_recent_auth_max_age_seconds          = 900
  candidate_rights_export_lifecycle_days                = 1
  document_processing_deployment_stage                  = "parser-dark"
  document_parser_artifact_s3_key                       = "lambda/parser.zip"
  document_parser_artifact_s3_object_version            = "synthetic-parser-version"
  document_parser_artifact_sha256                       = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  document_parser_artifact_base64sha256                 = "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="
  restricted_packet_keys_provisioned                    = true
}


override_resource {
  target          = aws_kms_key.restricted_packet_encryption[0]
  override_during = plan
  values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012" }
}
override_resource {
  target          = aws_kms_key.restricted_packet_fingerprint[0]
  override_during = plan
  values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012" }
}

# The candidate-rights maintenance function finishes resume purges. A native resume generation bound to a task that
# ECS no longer describes can only be settled by showing the task is gone (Documents migration 0021), so the function
# may DESCRIBE tasks, and only in the native clusters this deployment already retains.
run "resume_purge_may_only_describe_tasks_in_the_retained_native_clusters" {
  command = plan
  variables {
    gateway_native_materials = {
      disposal_enabled = true
      disposal_deployments = [{
        cluster_arn         = "arn:aws:ecs:us-east-2:111122223333:cluster/native-materials"
        task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-staging-native-resume:7"
        container_name      = "native-resume"
      }]
    }
  }
  assert {
    condition = (
      length([for s in data.aws_iam_policy_document.candidate_rights_activity[0].statement : s if startswith(s.sid, "ResumePurgeNativeTaskObservation")]) == 1 &&
      alltrue([for s in data.aws_iam_policy_document.candidate_rights_activity[0].statement :
        s.sid == "ResumePurgeNativeTaskObservation0" &&
        s.effect == "Allow" &&
        s.actions == toset(["ecs:DescribeTasks"]) &&
        s.resources == toset(["arn:aws:ecs:us-east-2:111122223333:task/native-materials/*"]) &&
        one(s.condition).test == "ArnEquals" &&
        one(s.condition).variable == "ecs:cluster" &&
        one(one(s.condition).values) == "arn:aws:ecs:us-east-2:111122223333:cluster/native-materials"
        if startswith(s.sid, "ResumePurgeNativeTaskObservation")
      ])
    )
    error_message = "The rights activity may only DESCRIBE tasks, in exactly the retained native cluster: no StopTask, RunTask or other cluster."
  }
  assert {
    condition     = aws_lambda_function.profile_readiness_activity[0].environment[0].variables.CANDIDATE_RIGHTS_NATIVE_TASK_CLUSTER_ARNS == "arn:aws:ecs:us-east-2:111122223333:cluster/native-materials"
    error_message = "The purge sweep must be told exactly the clusters it may ask about."
  }
  assert {
    condition = (
      length(local.candidate_rights_native_task_endpoint_statements) == 1 &&
      local.candidate_rights_native_task_endpoint_statements[0].Action == ["ecs:DescribeTasks"] &&
      local.candidate_rights_native_task_endpoint_statements[0].Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-staging-profile-readiness-activity" &&
      local.candidate_rights_native_task_endpoint_statements[0].Condition.ArnEquals["ecs:cluster"] == "arn:aws:ecs:us-east-2:111122223333:cluster/native-materials"
    )
    error_message = "The private ECS endpoint must admit the rights activity role for DescribeTasks only, in that cluster."
  }
}

run "resume_purge_has_no_task_access_without_a_retained_native_cluster" {
  command = plan
  assert {
    condition = (
      length([for s in data.aws_iam_policy_document.candidate_rights_activity[0].statement : s if startswith(s.sid, "ResumePurgeNativeTaskObservation")]) == 0 &&
      !contains(keys(aws_lambda_function.profile_readiness_activity[0].environment[0].variables), "CANDIDATE_RIGHTS_NATIVE_TASK_CLUSTER_ARNS") &&
      length(local.candidate_rights_native_task_endpoint_statements) == 0
    )
    error_message = "Without a retained native cluster the rights activity must gain no ECS permission, environment or endpoint access."
  }
}
