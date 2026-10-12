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
      arn = "arn:aws:iam::111122223333:policy/ai-job-apply-development-workload-boundary"
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
        DurableAliasArn   = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-profile-readiness-durable:development"
        DurableVersionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-profile-readiness-durable:1"
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
      arn        = "arn:aws:lambda:us-east-2:111122223333:function:mock:development"
      invoke_arn = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:111122223333:function:mock:development/invocations"
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
  environment = "development"
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

run "export_with_existing_private_owners" {
  command = plan
  override_resource {
    target          = aws_kms_key.platform
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" }
  }
  override_resource {
    target          = aws_kms_key.restricted_answer_vault[0]
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/42345678-1234-4234-8234-123456789012" }
  }
  variables {
    restricted_packet_keys_provisioned           = true
    restricted_packet_export_enabled             = true
    candidate_deletion_restore_role_enabled      = true
    native_preparation_releases                  = { r1 = { "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-r1", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-failed-r1", "kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-native-launch:9", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "security_group_ids" : ["sg-0123456789abcdef0"] } }
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
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
  }

  assert {
    condition     = alltrue([for s in local.preparation_existing_kms_access : s.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-development-${startswith(s.Sid, "Gateway") ? "gateway-lambda" : startswith(s.Sid, "Activity") ? "profile-readiness-activity" : "deletion-restore"}"])
    error_message = "Each existing capability must bind its exact owning role."
  }
  assert {
    condition     = length(jsondecode(aws_vpc_endpoint.native_preparation_kms[0].policy).Statement) == 8 && aws_vpc_endpoint.native_preparation_kms[0].private_dns_enabled
    error_message = "Private DNS must preserve five existing scoped grants alongside two preparation packet grants."
  }
  assert {
    condition     = alltrue([for s in local.preparation_existing_kms_access : s.Resource != var.native_preparation_releases.r1.packet_encryption_key_arn && s.Resource != var.native_preparation_releases.r1.packet_fingerprint_key_arn && contains(["restricted-answer-vault-v1", "candidate-deletion-recovery-v1"], s.Condition.StringEquals["kms:EncryptionContext:purpose"])])
    error_message = "Existing actors must remain purpose/key bound and get no preparation packet key."
  }
  assert {
    condition     = alltrue([for s in local.preparation_existing_kms_access : toset(s.Action) == toset(["kms:Decrypt"]) if contains(["ActivityVaultExport", "RestoreDeletionLocator"], s.Sid)]) && alltrue([for s in local.preparation_existing_kms_access : toset(s.Action) == toset(["kms:Encrypt"]) if s.Sid == "GatewayDeletionLocator"])
    error_message = "Export/restore stay decrypt-only; gateway locators stay encrypt-only."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.restricted_packet_export[0].policy).Statement[0].Action == ["kms:Decrypt"] && jsondecode(aws_iam_role_policy.restricted_packet_export[0].policy).Statement[0].Resource == aws_kms_key.restricted_packet_encryption[0].arn && jsondecode(aws_iam_role_policy.restricted_packet_export[0].policy).Statement[0].Condition.StringEquals["kms:EncryptionContext:purpose"] == "restricted-application-packet.v1"
    error_message = "Export role may only decrypt the exact purpose-bound packet encryption key."
  }
  assert {
    condition     = aws_lambda_function.profile_readiness_activity[0].environment[0].variables.RESTRICTED_PACKET_EXPORT_ENABLED == "true" && aws_lambda_function.profile_readiness_activity[0].environment[0].variables.RESTRICTED_PACKET_ENCRYPTION_KEY_ARN == aws_kms_key.restricted_packet_encryption[0].arn && aws_lambda_function.profile_readiness_activity[0].environment[0].variables.RESTRICTED_PACKET_FINGERPRINT_KEY_ARN == aws_kms_key.restricted_packet_fingerprint[0].arn && !contains(keys(aws_lambda_function.profile_readiness_activity[0].environment[0].variables), "RESTRICTED_PACKET_PROTECTION_ENABLED")
    error_message = "Existing rights activity must receive export-only configuration, with fingerprint identity but no writer enablement."
  }
  assert {
    condition     = length([for statement in jsondecode(aws_vpc_endpoint.native_preparation_kms[0].policy).Statement : statement if try(statement.Sid, "") == "ActivityPacketExport" && statement.Action == ["kms:Decrypt"] && statement.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-development-profile-readiness-activity"]) == 1
    error_message = "Private KMS must admit the original rights activity without writer or fingerprint operations."
  }

}

run "default_off" {
  command = plan
  assert {
    condition     = length(aws_iam_role_policy.restricted_packet_export) == 0 && length(local.packet_export_environment) == 0 && length(aws_vpc_endpoint.native_preparation_kms) == 0
    error_message = "Default must not activate protected packet export or create its access path."
  }
}
run "missing_prerequisites" {
  command = plan
  variables { restricted_packet_export_enabled = true }
  expect_failures = [var.restricted_packet_export_enabled]
}

run "export_without_preparation" {
  command = plan
  override_resource {
    target          = aws_kms_key.platform
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" }
  }
  override_resource {
    target          = aws_kms_key.restricted_answer_vault[0]
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/42345678-1234-4234-8234-123456789012" }
  }

  variables {
    restricted_packet_keys_provisioned           = true
    restricted_packet_export_enabled             = true
    candidate_deletion_restore_role_enabled      = true
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
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
  }
  assert {
    condition     = length(aws_vpc_endpoint.native_preparation_kms) == 1 && length(aws_sqs_queue.native_preparation) == 0 && length(jsondecode(aws_vpc_endpoint.native_preparation_kms[0].policy).Statement) == 6
    error_message = "Existing packet export must remain reachable without a generation/preparation release."
  }
}
run "missing_applications_owner" {
  command = plan
  variables {
    restricted_packet_keys_provisioned           = true
    restricted_packet_export_enabled             = true
    candidate_deletion_restore_role_enabled      = true
    private_application_networking               = true
    deploy_document_intake                       = true
    serverless_runtime_enabled                   = true
    restricted_answer_vault_enabled              = true
    restricted_answer_export_enabled             = true
    candidate_rights_enabled                     = true
    candidate_rights_policy_version              = "d3-development-synthetic-v1"
    candidate_rights_policy_sha256               = "9999999999999999999999999999999999999999999999999999999999999999"
    candidate_rights_owner_inventory             = "identity,profile,documents,jobs,matching,billing,trust"
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
  }
  expect_failures = [var.restricted_packet_export_enabled]
}

run "saved_answer_reuse_default_off" {
  command = plan
  assert {
    condition     = !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "RESTRICTED_ANSWER_REUSE_ENABLED")
    error_message = "Saved-answer reuse must remain absent by default."
  }
}

run "saved_answer_reuse_exact_prerequisites" {
  command = plan
  variables {
    restricted_answer_reuse_enabled    = true
    restricted_answer_vault_enabled    = true
    restricted_packet_keys_provisioned = true
    gateway_native_materials           = { packet_protection_enabled = true }
  }
  override_resource {
    target          = aws_kms_key.restricted_answer_vault[0]
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/42345678-1234-4234-8234-123456789012" }
  }
  assert {
    condition     = aws_lambda_function.gateway[0].environment[0].variables.RESTRICTED_ANSWER_REUSE_ENABLED == "true"
    error_message = "A reviewed saved-answer release must reach the Gateway environment."
  }
}

run "saved_answer_reuse_without_vault_refused" {
  command = plan
  variables {
    restricted_answer_reuse_enabled    = true
    restricted_packet_keys_provisioned = true
  }
  expect_failures = [var.restricted_answer_reuse_enabled]
}

run "saved_answer_reuse_without_packet_keys_refused" {
  command = plan
  variables {
    restricted_answer_reuse_enabled = true
    restricted_answer_vault_enabled = true
  }
  expect_failures = [var.restricted_answer_reuse_enabled]
}

run "saved_answer_reuse_without_packet_protection_refused" {
  command = plan
  variables {
    restricted_answer_reuse_enabled    = true
    restricted_answer_vault_enabled    = true
    restricted_packet_keys_provisioned = true
    gateway_native_materials           = {}
  }
  expect_failures = [var.restricted_answer_reuse_enabled]
}
