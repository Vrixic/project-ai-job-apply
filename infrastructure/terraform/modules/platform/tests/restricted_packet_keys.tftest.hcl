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
    condition     = length(aws_kms_key.restricted_packet_encryption) == 0 && length(aws_kms_key.restricted_packet_fingerprint) == 0 && output.restricted_packet_key_bindings == null
    error_message = "Default plans must not provision packet keys."
  }
}
run "keys_without_activation" {
  command = plan
  variables { restricted_packet_keys_provisioned = true }
  assert {
    condition     = aws_kms_key.restricted_packet_encryption[0].customer_master_key_spec == "SYMMETRIC_DEFAULT" && aws_kms_key.restricted_packet_encryption[0].key_usage == "ENCRYPT_DECRYPT" && aws_kms_key.restricted_packet_encryption[0].enable_key_rotation && aws_kms_key.restricted_packet_encryption[0].deletion_window_in_days == 30 && aws_kms_key.restricted_packet_fingerprint[0].customer_master_key_spec == "HMAC_256" && aws_kms_key.restricted_packet_fingerprint[0].key_usage == "GENERATE_VERIFY_MAC" && aws_kms_key.restricted_packet_fingerprint[0].enable_key_rotation != true && aws_kms_key.restricted_packet_fingerprint[0].deletion_window_in_days == 30
    error_message = "Provision distinct envelope and HMAC key types matching the runtime; HMAC cannot rotate automatically."
  }
  assert {
    condition     = jsondecode(aws_kms_key.restricted_packet_encryption[0].policy).Statement[1].Effect == "Deny" && jsondecode(aws_kms_key.restricted_packet_encryption[0].policy).Statement[1].Condition.StringNotEquals["kms:EncryptionContext:purpose"] == "restricted-application-packet.v1" && jsondecode(aws_kms_key.restricted_packet_fingerprint[0].policy).Statement[1].Condition.StringNotEquals["kms:MacAlgorithm"] == "HMAC_SHA_256"
    error_message = "Packet purpose and MAC algorithm must match the actual cipher."
  }
  assert {
    condition     = length(aws_sqs_queue.native_preparation) == 0 && length(aws_vpc_endpoint.native_preparation_kms) == 0 && length(jsondecode(aws_kms_key.restricted_packet_encryption[0].policy).Statement) == 2 && jsondecode(aws_kms_key.restricted_packet_encryption[0].policy).Statement[0].Principal.AWS == "arn:aws:iam::111122223333:root"
    error_message = "Key provisioning must neither activate preparation nor grant arbitrary runtime principals."
  }
}
run "requires_retained_data_plane" {
  command = plan
  variables {
    restricted_packet_keys_provisioned = true
    persistent_data_plane_enabled      = false
    database_deletion_protection       = false
  }
  expect_failures = [var.restricted_packet_keys_provisioned]
}
