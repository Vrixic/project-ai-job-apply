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
}


run "database_dormancy_preserves_data" {
  command = plan
  variables {
    private_application_networking               = false
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = false
    restricted_answer_vault_enabled              = true
    restricted_answer_export_enabled             = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d3-development-synthetic-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing,trust,applications"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
    document_processing_deployment_stage         = "parser-dark"
    document_parser_artifact_s3_key              = "lambda/parser.zip"
    document_parser_artifact_s3_object_version   = "synthetic-parser-version"
    document_parser_artifact_sha256              = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    document_parser_artifact_base64sha256        = "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="

    development_database_mode = "dormant"
    development_database_recovery = {
      address                   = "database.cluster.us-east-2.rds.amazonaws.com"
      port                      = 5432
      name                      = "ai_job_apply"
      resource_id               = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      final_snapshot_identifier = "ai-job-apply-development-shutdown-test"
    }


    environment                       = "development"
    private_service_endpoints_enabled = false

  }

  assert {
    condition     = length(aws_db_instance.postgres) == 0 && length(aws_s3_bucket.candidate_data_exports) == 1 && length(aws_s3_bucket.candidate_deletion_recovery) == 1 && length(aws_secretsmanager_secret_version.database_url) == 1 && length(aws_kms_key.restricted_answer_vault) == 1
    error_message = "Dormancy removes only DB compute; candidate data, connection and keys must survive."
  }
  assert {
    condition     = length(aws_vpc_endpoint.secretsmanager) == 0 && length(aws_vpc_endpoint.lambda) == 0 && length(aws_vpc_endpoint.sqs) == 0 && length(aws_nat_gateway.this) == 0 && length(aws_apigatewayv2_route.gateway) == 0 && !aws_lambda_event_source_mapping.outbox_starter[0].enabled && aws_cloudwatch_event_rule.candidate_rights_maintenance[0].state == "DISABLED"
    error_message = "Dormancy requires network and automatic work to remain off."
  }
}

run "prepare_keeps_database_until_snapshot_verified" {
  command = plan
  variables {
    private_application_networking               = false
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = false
    restricted_answer_vault_enabled              = true
    restricted_answer_export_enabled             = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d3-development-synthetic-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing,trust,applications"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
    document_processing_deployment_stage         = "parser-dark"
    document_parser_artifact_s3_key              = "lambda/parser.zip"
    document_parser_artifact_s3_object_version   = "synthetic-parser-version"
    document_parser_artifact_sha256              = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    document_parser_artifact_base64sha256        = "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="

    development_database_mode = "snapshot-prepared"
    development_database_recovery = {
      address                   = "database.cluster.us-east-2.rds.amazonaws.com"
      port                      = 5432
      name                      = "ai_job_apply"
      resource_id               = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      final_snapshot_identifier = "ai-job-apply-development-shutdown-test"
    }


    environment                       = "development"
    private_service_endpoints_enabled = false

  }
  assert {
    condition     = length(aws_db_instance.postgres) == 1 && !aws_db_instance.postgres[0].deletion_protection && !aws_db_instance.postgres[0].skip_final_snapshot && !aws_db_instance.postgres[0].delete_automated_backups && aws_db_instance.postgres[0].final_snapshot_identifier == "ai-job-apply-development-shutdown-test"
    error_message = "Preparation must keep DB and guarantee final snapshot plus automated backup retention."
  }
}

run "restore_requires_exact_snapshot" {
  command = plan
  variables {
    private_application_networking               = false
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = false
    restricted_answer_vault_enabled              = true
    restricted_answer_export_enabled             = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d3-development-synthetic-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing,trust,applications"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
    document_processing_deployment_stage         = "parser-dark"
    document_parser_artifact_s3_key              = "lambda/parser.zip"
    document_parser_artifact_s3_object_version   = "synthetic-parser-version"
    document_parser_artifact_sha256              = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    document_parser_artifact_base64sha256        = "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="

    development_database_mode = "restore"
    development_database_recovery = {
      address                   = "database.cluster.us-east-2.rds.amazonaws.com"
      port                      = 5432
      name                      = "ai_job_apply"
      resource_id               = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      final_snapshot_identifier = "ai-job-apply-development-shutdown-test"
    }


    environment                       = "development"
    private_service_endpoints_enabled = false

  }
  expect_failures = [var.development_database_recovery]
}

run "dormancy_rejects_active_runtime" {
  command = plan
  variables {
    private_application_networking               = false
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    restricted_answer_vault_enabled              = true
    restricted_answer_export_enabled             = false
    candidate_rights_enabled                     = false
    candidate_rights_policy_version              = "d3-development-synthetic-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing,trust,applications"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
    document_processing_deployment_stage         = "parser-dark"
    document_parser_artifact_s3_key              = "lambda/parser.zip"
    document_parser_artifact_s3_object_version   = "synthetic-parser-version"
    document_parser_artifact_sha256              = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    document_parser_artifact_base64sha256        = "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="

    development_database_mode = "dormant"
    development_database_recovery = {
      address                   = "database.cluster.us-east-2.rds.amazonaws.com"
      port                      = 5432
      name                      = "ai_job_apply"
      resource_id               = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      final_snapshot_identifier = "ai-job-apply-development-shutdown-test"
    }


    environment                       = "development"
    private_service_endpoints_enabled = true

  }
  expect_failures = [var.development_database_mode]
}

run "restore_binds_exact_encrypted_snapshot" {
  command = plan
  variables {
    private_application_networking               = false
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = false
    restricted_answer_vault_enabled              = true
    restricted_answer_export_enabled             = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d3-development-synthetic-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing,trust,applications"
    candidate_rights_subprocessor_inventory      = "none"
    candidate_rights_export_lifetime_seconds     = 3600
    candidate_rights_download_grant_seconds      = 300
    candidate_rights_backup_retention_days       = 7
    candidate_rights_recent_auth_max_age_seconds = 900
    candidate_rights_export_lifecycle_days       = 1
    document_processing_deployment_stage         = "parser-dark"
    document_parser_artifact_s3_key              = "lambda/parser.zip"
    document_parser_artifact_s3_object_version   = "synthetic-parser-version"
    document_parser_artifact_sha256              = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    document_parser_artifact_base64sha256        = "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="

    development_database_mode = "restore"
    development_database_recovery = {
      address                     = "database.cluster.us-east-2.rds.amazonaws.com"
      port                        = 5432
      name                        = "ai_job_apply"
      resource_id                 = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      final_snapshot_identifier   = "ai-job-apply-development-shutdown-next"
      restore_snapshot_identifier = "ai-job-apply-development-shutdown-test"
    }


    environment                       = "development"
    private_service_endpoints_enabled = false

  }
  assert {
    condition     = aws_db_instance.postgres[0].snapshot_identifier == "ai-job-apply-development-shutdown-test" && aws_db_instance.postgres[0].storage_encrypted && aws_db_instance.postgres[0].deletion_protection && !aws_db_instance.postgres[0].skip_final_snapshot
    error_message = "Restore must use the retained snapshot, protect the database and preserve future final snapshots."
  }
}
