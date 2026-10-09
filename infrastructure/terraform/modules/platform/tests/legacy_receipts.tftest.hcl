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
  name        = "ai-job-apply"
  environment = "development"
  vpc_cidr    = "10.30.0.0/16"
}
run "default_off" {
  command = plan
  assert {
    condition     = length(aws_kms_key.legacy_receipt_encryption) == 0 && length(aws_ecs_task_definition.legacy_receipt_transition) == 0 && length(aws_iam_role_policy.legacy_receipt_replay) == 0
    error_message = "No legacy receipt key or caller may be enabled by default."
  }
}
run "retained_key_only" {
  command = plan
  variables { legacy_receipt_key_provisioned = true }
  assert {
    condition     = length(aws_kms_key.legacy_receipt_encryption) == 1 && length(aws_iam_role.legacy_receipt_transition) == 0 && length(aws_iam_role_policy.legacy_receipt_replay) == 0
    error_message = "Provisioning a retained key must not grant a caller."
  }
  assert {
    condition     = jsondecode(aws_kms_key.legacy_receipt_encryption[0].policy).Statement[1].Condition.StringNotEquals["kms:EncryptionContext:purpose"] == "restricted-legacy-application-receipt.v1"
    error_message = "The dedicated key must reject every other purpose."
  }
}
run "maintenance_task_and_exact_purpose" {
  command = plan
  override_resource {
    target          = aws_kms_key.legacy_receipt_encryption[0]
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111" }
  }
  override_resource {
    target          = aws_iam_role.legacy_receipt_transition[0]
    override_during = plan
    values          = { arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-legacy-receipt-transition" }
  }
  override_resource {
    target          = aws_iam_role.execution
    override_during = plan
    values          = { arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-execution" }
  }
  override_resource {
    target          = aws_db_instance.postgres[0]
    override_during = plan
    values          = { resource_id = "db-ABCDEFGHIJKLMNOPQRSTUVWX", address = "ai-job-apply-development.abcdefghijkl.us-east-2.rds.amazonaws.com", port = 5432, db_name = "ai_job_apply" }
  }
  override_resource {
    target          = aws_secretsmanager_secret.database_url
    override_during = plan
    values          = { arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-ABCDEF" }
  }
  override_resource {
    target          = aws_security_group.migration_aws_endpoints[0]
    override_during = plan
    values          = { id = "sg-11111111111111111" }
  }
  override_resource {
    target          = aws_ecr_repository.migration
    override_during = plan
    values          = { repository_url = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration" }
  }
  variables {
    legacy_receipt_key_provisioned    = true
    private_service_endpoints_enabled = true
    migration_image                   = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    legacy_receipt_transition         = { run_id = "11111111111111111111111111111111", source_sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", snapshot_arn = "arn:aws:rds:us-east-2:111122223333:snapshot:ai-job-apply-development-synthetic", snapshot_created_at = "2026-10-09T04:00:00.000Z", expected_applied_migrations = 3, expected_legacy_receipts = 7, issued_at = "2026-10-09T04:05:00.000Z", expires_at = "2026-10-09T04:35:00.000Z" }
  }
  assert {
    condition     = length(aws_ecs_task_definition.legacy_receipt_transition) == 1 && length(aws_iam_role_policy.legacy_receipt_replay) == 0
    error_message = "Maintenance must remain separate from Gateway replay."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.legacy_receipt_transition[0].policy).Statement[0].Action == ["kms:Encrypt", "kms:Decrypt"] && jsondecode(aws_iam_role_policy.legacy_receipt_transition[0].policy).Statement[0].Resource == aws_kms_key.legacy_receipt_encryption[0].arn
    error_message = "Maintenance may access only its dedicated encrypt/decrypt key."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.legacy_receipt_transition[0].container_definitions)[0].command == ["applications/dist/src/run-legacy-receipt-transition.js"] && aws_ecs_task_definition.legacy_receipt_transition[0].task_role_arn == aws_iam_role.legacy_receipt_transition[0].arn
    error_message = "The maintenance task must bind its exact command and task role."
  }
  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.migration[0].container_definitions)[0].environment) == 1
    error_message = "Ordinary migration must not inherit maintenance authority."
  }
  assert {
    condition     = contains(aws_vpc_endpoint.native_preparation_kms[0].security_group_ids, aws_security_group.migration_aws_endpoints[0].id)
    error_message = "The private KMS endpoint must admit the exact maintenance network."
  }
}
