mock_provider "aws" {
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:us-east-2:111122223333:ai-job-apply-development-operations" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } }

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
  name          = "ai-job-apply"
  environment   = "development"
  vpc_cidr      = "10.20.0.0/16"
  oidc_issuer   = "https://example.auth0.com/"
  oidc_audience = "https://api.example.invalid"
}



run "absent" {
  command = plan
  assert {
    condition     = length(aws_sqs_queue.native_preparation) == 0 && length(aws_sqs_queue.native_preparation_failure) == 0 && length(aws_vpc_endpoint.native_preparation_kms) == 0 && length(aws_cloudwatch_metric_alarm.native_preparation) == 0
    error_message = "Default must create no preparation infrastructure."
  }
}
run "original_private_release" {
  command = plan
  override_resource {
    target          = aws_sqs_queue.native_preparation_failure["r1"]
    override_during = plan
    values          = { arn = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-failed-r1" }
  }
  variables { native_preparation_releases = { r1 = { "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-r1", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-failed-r1", "kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-native-launch:9", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "security_group_ids" : ["sg-0123456789abcdef0"] } } }
  assert {
    condition     = aws_sqs_queue.native_preparation["r1"].visibility_timeout_seconds == 360 && aws_sqs_queue.native_preparation_failure["r1"].message_retention_seconds == 1209600 && jsondecode(aws_sqs_queue.native_preparation["r1"].redrive_policy).maxReceiveCount == 5
    error_message = "Original queue must retain failed work and exceed the starter invocation budget."
  }
  assert {
    condition     = length(aws_vpc_endpoint.lambda) == 1 && length(aws_vpc_endpoint.sqs) == 1 && length(aws_vpc_endpoint.secretsmanager) == 1 && length(aws_vpc_endpoint.native_preparation_kms) == 1
    error_message = "Private preparation requires all four service endpoints."
  }
  assert {
    condition     = length([for s in data.aws_iam_policy_document.outbox_lambda_endpoint[0].statement : s if s.sid == "PreparationRpcr1activity" && s.resources == toset([var.native_preparation_releases.r1.launcher_function_arn])]) == 1 && length([for s in data.aws_iam_policy_document.outbox_lambda_endpoint[0].statement : s if s.sid == "PreparationRpcr1terminal" && s.actions == toset(["lambda:GetDurableExecution"])]) == 1
    error_message = "Activity must invoke only its numeric launcher; recovery gets metadata only."
  }
  assert {
    condition     = length([for s in data.aws_iam_policy_document.secrets_endpoint[0].statement : s if startswith(s.sid, "PreparationSecret")]) == 4 && length([for s in data.aws_iam_policy_document.outbox_sqs_endpoint[0].statement : s if startswith(s.sid, "PreparationQueue")]) == 3
    error_message = "Only private owners get the database secret and exact queue actors get access."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_vpc_endpoint.native_preparation_kms[0].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == local.preparation_roles.r1.activity]) && length(aws_cloudwatch_metric_alarm.native_preparation) == 19
    error_message = "Packet keys are activity-only and all configured failure signals must alarm."
  }
  assert {
    condition     = length([for s in data.aws_iam_policy_document.platform_kms.statement : s if s.sid == "PreparationStater1"]) == 1 && jsondecode(aws_sqs_queue_policy.native_preparation_failure["r1"].policy).Statement[0].Condition.ArnEquals["aws:SourceArn"] == local.preparation_rules.r1
    error_message = "Durable state and failed delivery must bind only original function/rules."
  }
}
run "alias_refused" {
  command = plan
  variables { native_preparation_releases = { r1 = { "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-r1", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-failed-r1", "kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-native-launch:live", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "security_group_ids" : ["sg-0123456789abcdef0"] } } }
  expect_failures = [var.native_preparation_releases]
}

run "dormant_retains_preparation_queues_without_paid_endpoints" {
  command = plan
  override_resource {
    target          = aws_sqs_queue.native_preparation_failure["r1"]
    override_during = plan
    values          = { arn = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-failed-r1" }
  }
  variables {
    native_preparation_releases       = { r1 = { "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-r1", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-failed-r1", "kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-Abc123", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-native-launch:9", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "security_group_ids" : ["sg-0123456789abcdef0"] } }
    development_database_mode         = "dormant"
    private_service_endpoints_enabled = false
    development_database_recovery = {
      address                   = "database.cluster.us-east-2.rds.amazonaws.com"
      port                      = 5432
      name                      = "ai_job_apply"
      resource_id               = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      final_snapshot_identifier = "ai-job-apply-development-shutdown-native"
    }
  }
  assert {
    condition     = length(aws_db_instance.postgres) == 0 && length(aws_sqs_queue.native_preparation) == 1 && length(aws_sqs_queue.native_preparation_failure) == 1
    error_message = "Dormancy must retain original preparation queues while removing database compute."
  }
  assert {
    condition     = length(aws_vpc_endpoint.native_preparation_kms) == 0 && length(aws_vpc_endpoint.lambda) == 0 && length(aws_vpc_endpoint.sqs) == 0 && length(aws_vpc_endpoint.secretsmanager) == 0
    error_message = "Retained preparation release must not force paid endpoints during shutdown."
  }
}
