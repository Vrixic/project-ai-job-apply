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

  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration" }
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
  name                              = "ai-job-apply"
  environment                       = "development"
  vpc_cidr                          = "10.20.0.0/16"
  legacy_receipt_key_provisioned    = true
  private_service_endpoints_enabled = false
  development_database_mode         = "dormant"
  development_database_recovery = {
    address                   = "ai-job-apply-development.example.us-east-2.rds.amazonaws.com"
    port                      = 5432
    name                      = "ai_job_apply"
    resource_id               = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
    final_snapshot_identifier = "ai-job-apply-development-shutdown-synthetic"
  }
  migration_image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
run "default_off" {
  command = plan
  assert {
    condition     = length(aws_iam_role.application_restore_reconciliation) == 0 && length(aws_iam_role_policy.application_restore_reconciliation) == 0 && length(aws_ecs_task_definition.application_restore_reconciliation) == 0
    error_message = "Retained keys and the ordinary migration image must not admit diagnostic callers."
  }
}
run "exact_read_only_timed_authority" {
  command = plan
  override_resource {
    target          = aws_kms_key.legacy_receipt_encryption[0]
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111" }
  }
  override_resource {
    target          = aws_iam_role.application_restore_reconciliation[0]
    override_during = plan
    values          = { arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-restore-reconciliation" }
  }
  override_resource {
    target          = aws_iam_role.execution
    override_during = plan
    values          = { arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-execution" }
  }
  override_resource {
    target          = aws_secretsmanager_secret.database_url
    override_during = plan
    values          = { arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-ABCDEF" }
  }
  override_resource {
    target          = aws_ecr_repository.migration
    override_during = plan
    values          = { repository_url = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration" }
  }
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.application_restore_reconciliation[0].policy).Statement) == 1 && jsondecode(aws_iam_role_policy.application_restore_reconciliation[0].policy).Statement[0].Action == ["kms:Decrypt"] && jsondecode(aws_iam_role_policy.application_restore_reconciliation[0].policy).Statement[0].Resource == aws_kms_key.legacy_receipt_encryption[0].arn
    error_message = "Diagnostic permission must be exactly decrypt-only on the retained receipt key."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.application_restore_reconciliation[0].policy).Statement[0].Condition.StringEquals["kms:EncryptionContext:purpose"] == "restricted-legacy-application-receipt.v1" && jsondecode(aws_iam_role_policy.application_restore_reconciliation[0].policy).Statement[0].Condition.DateGreaterThanEquals["aws:CurrentTime"] == var.application_restore_reconciliation.issued_at && jsondecode(aws_iam_role_policy.application_restore_reconciliation[0].policy).Statement[0].Condition.DateLessThan["aws:CurrentTime"] == var.application_restore_reconciliation.expires_at
    error_message = "Purpose and both IAM time boundaries must be enforced, independent of process lifetime."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.application_restore_reconciliation[0].policy).Statement[0].Condition["ForAllValues:StringEquals"]["kms:EncryptionContextKeys"] == ["purpose", "owner_user_id", "application_id", "protection_id", "operation", "metadata_sha256"]
    error_message = "Only the owning cipher's value-free context keys may be admitted."
  }
  assert {
    condition     = aws_iam_role.application_restore_reconciliation[0].permissions_boundary == data.aws_iam_policy.workload_boundary.arn && aws_ecs_task_definition.application_restore_reconciliation[0].task_role_arn == aws_iam_role.application_restore_reconciliation[0].arn && aws_ecs_task_definition.application_restore_reconciliation[0].execution_role_arn == aws_iam_role.execution.arn
    error_message = "Diagnostic must retain the workload ceiling and separate task/execution authorities."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.application_restore_reconciliation[0].container_definitions)[0].command == ["runner/dist/src/application-restore-reconciliation-cli.js"] && jsondecode(aws_ecs_task_definition.application_restore_reconciliation[0].container_definitions)[0].readonlyRootFilesystem && jsondecode(aws_ecs_task_definition.application_restore_reconciliation[0].container_definitions)[0].environment == [{ name = "NODE_ENV", value = "production" }, { name = "RESTORE_APPLICATIONS_RECONCILIATION_ENABLED", value = "false" }]
    error_message = "The immutable diagnostic command must default off with a read-only filesystem."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.application_restore_reconciliation[0].container_definitions)[0].image == var.application_restore_reconciliation.image && jsondecode(aws_ecs_task_definition.migration[0].container_definitions)[0].image == var.migration_image && length(jsondecode(aws_ecs_task_definition.migration[0].container_definitions)[0].environment) == 1
    error_message = "Diagnostic image/admission must not alter the ordinary migration task."
  }
  assert {
    condition     = length(aws_db_instance.postgres) == 0 && length(aws_vpc_endpoint.native_preparation_kms) == 0 && length(aws_iam_role.legacy_receipt_transition) == 0 && length(aws_iam_role_policy.legacy_receipt_replay) == 0
    error_message = "Diagnostic registration must not provision a primary, paid KMS endpoint, transition or Gateway replay permission."
  }
  assert {
    condition     = aws_ecs_task_definition.application_restore_reconciliation[0].tags.DiagnosticRunId == var.application_restore_reconciliation.run_id && aws_ecs_task_definition.application_restore_reconciliation[0].tags.SourceSha == var.application_restore_reconciliation.source_sha && aws_ecs_task_definition.application_restore_reconciliation[0].tags.AuthorityExpiresAt == var.application_restore_reconciliation.expires_at
    error_message = "Operator readback must bind the exact run, source and authority lifetime."
  }
  assert {
    condition     = aws_ecs_task_definition.application_restore_reconciliation[0].tags.AuthorityIssuedAt == var.application_restore_reconciliation.issued_at && aws_ecs_task_definition.application_restore_reconciliation[0].requires_compatibilities == toset(["FARGATE"]) && aws_ecs_task_definition.application_restore_reconciliation[0].network_mode == "awsvpc" && aws_ecs_task_definition.application_restore_reconciliation[0].cpu == "256" && aws_ecs_task_definition.application_restore_reconciliation[0].memory == "512" && aws_ecs_task_definition.application_restore_reconciliation[0].runtime_platform[0].cpu_architecture == "X86_64" && aws_ecs_task_definition.application_restore_reconciliation[0].runtime_platform[0].operating_system_family == "LINUX" && !aws_ecs_task_definition.application_restore_reconciliation[0].enable_fault_injection
    error_message = "Diagnostic must bind the exact non-fault-injected Fargate platform, budget and issue time."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.application_restore_reconciliation[0].container_definitions)[0].secrets == [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }] && jsondecode(aws_ecs_task_definition.application_restore_reconciliation[0].container_definitions)[0].logConfiguration.options["awslogs-stream-prefix"] == "restore-reconciliation" && jsondecode(aws_ecs_task_definition.application_restore_reconciliation[0].container_definitions)[0].logConfiguration.options["awslogs-region"] == "us-east-2"
    error_message = "Diagnostic must use only the existing database secret and its dedicated original log stream."
  }
}
run "missing_retained_key" {
  command = plan
  variables {
    legacy_receipt_key_provisioned     = false
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "retained_primary" {
  command = plan
  variables {
    development_database_mode          = "retained"
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "staging" {
  command = plan
  variables {
    environment                        = "staging"
    development_database_mode          = "retained"
    private_service_endpoints_enabled  = true
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "too_long" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:01.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "empty_window" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:00:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "reversed_window" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T03:59:59.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "fractional_time" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.001Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "malformed_time" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "invalid", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "invalid_source" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "short", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "wrong_repository" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/other/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "wrong_account" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "444455556666.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "mutable_image" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration:latest", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "malformed_run" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "bad", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "wrong_image_region" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-west-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}

run "paid_endpoints" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
    private_service_endpoints_enabled  = true
  }
  expect_failures = [var.development_database_mode]
}

run "gateway_replay_still_requires_protected_gateway" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
    legacy_receipt_replay_enabled      = true
  }
  expect_failures = [var.legacy_receipt_replay_enabled]
}

run "retained_gateway_replay_with_runtime_off" {
  command = plan
  variables {
    application_restore_reconciliation        = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
    legacy_receipt_replay_enabled             = true
    serverless_runtime_enabled                = false
    deploy_applications                       = true
    deploy_gateway_lambda                     = true
    gateway_lambda_artifact_s3_key            = "lambda/gateway.zip"
    gateway_lambda_artifact_s3_object_version = "gateway-version"
    gateway_lambda_artifact_sha256            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    gateway_lambda_artifact_base64sha256      = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
    gateway_lambda_extension_layer_arn        = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
    restricted_packet_keys_provisioned        = true
    gateway_native_materials                  = { packet_protection_enabled = true }
    oidc_issuer                               = "https://example.auth0.com/"
    oidc_audience                             = "https://api.example.invalid"
  }
  assert {
    condition     = length(aws_iam_role_policy.legacy_receipt_replay) == 1 && length(aws_ecs_task_definition.application_restore_reconciliation) == 1 && length(aws_apigatewayv2_route.gateway) == 0
    error_message = "Retained Gateway replay permission must coexist with the isolated diagnostic without activating public routes."
  }
}

run "active_serverless_runtime_rejected" {
  command = plan
  variables {
    application_restore_reconciliation        = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
    serverless_runtime_enabled                = true
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
  }
  # The endpoint input rejects active runtime before the diagnostic validation can run.
  expect_failures = [var.private_service_endpoints_enabled]
}

run "transition_cannot_share_authority" {
  command = plan
  variables {
    application_restore_reconciliation = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
    development_database_mode          = "retained"
    private_service_endpoints_enabled  = true
    legacy_receipt_transition          = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", snapshot_arn = "arn:aws:rds:us-east-2:111122223333:snapshot:ai-job-apply-development-synthetic", snapshot_created_at = "2026-10-10T03:59:00.000Z", expected_applied_migrations = 3, expected_legacy_receipts = 7, issued_at = "2026-10-10T04:00:00.000Z", expires_at = "2026-10-10T04:30:00.000Z" }
  }
  expect_failures = [var.application_restore_reconciliation]
}
