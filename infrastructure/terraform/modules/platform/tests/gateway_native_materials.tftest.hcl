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
  deploy_applications                       = true
  deploy_gateway_lambda                     = true
  gateway_lambda_artifact_s3_key            = "lambda/gateway.zip"
  gateway_lambda_artifact_s3_object_version = "gateway-version"
  gateway_lambda_artifact_sha256            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  gateway_lambda_artifact_base64sha256      = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
  gateway_lambda_extension_layer_arn        = "arn:aws:lambda:us-east-2:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:114"
  restricted_packet_keys_provisioned        = true
  name                                      = "ai-job-apply"
  environment                               = "development"
  vpc_cidr                                  = "10.20.0.0/16"
  oidc_issuer                               = "https://example.auth0.com/"
  oidc_audience                             = "https://api.example.invalid"
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
run "absent" {
  command = plan
  assert {
    condition     = length(aws_iam_role_policy.gateway_native_packet) == 0 && length(aws_vpc_endpoint.native_preparation_kms) == 0 && !contains(keys(aws_lambda_function.gateway[0].environment[0].variables), "RESTRICTED_PACKET_PROTECTION_ENABLED")
    error_message = "Absent configuration must preserve Gateway permissions and environment."
  }
}
run "provisioned_dark" {
  command = plan
  variables { gateway_native_materials = {} }
  assert {
    condition     = alltrue([for key, value in local.gateway_native_material_environment : value == "false" if endswith(key, "ENABLED")]) && length(aws_iam_role_policy.gateway_native_packet) == 1 && length(aws_vpc_endpoint.native_preparation_kms) == 1
    error_message = "Provisioning must wire private KMS reachability without activating the candidate flow."
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.gateway_native_packet[0].policy).Statement) == 2 && jsondecode(aws_iam_role_policy.gateway_native_packet[0].policy).Statement[0].Resource == aws_kms_key.restricted_packet_encryption[0].arn && toset(jsondecode(aws_iam_role_policy.gateway_native_packet[0].policy).Statement[0].Action) == toset(["kms:GenerateDataKey", "kms:Decrypt"]) && jsondecode(aws_iam_role_policy.gateway_native_packet[0].policy).Statement[0].Condition.StringEquals["kms:EncryptionContext:purpose"] == "restricted-application-packet.v1" && jsondecode(aws_iam_role_policy.gateway_native_packet[0].policy).Statement[1].Resource == aws_kms_key.restricted_packet_fingerprint[0].arn && jsondecode(aws_iam_role_policy.gateway_native_packet[0].policy).Statement[1].Action == ["kms:GenerateMac"] && jsondecode(aws_iam_role_policy.gateway_native_packet[0].policy).Statement[1].Condition.StringEquals["kms:MacAlgorithm"] == "HMAC_SHA_256"
    error_message = "Gateway packet operations must be purpose/algorithm bound to separate exact keys."
  }
  assert {
    condition     = length(jsondecode(aws_vpc_endpoint.native_preparation_kms[0].policy).Statement) == 2 && alltrue([for s in jsondecode(aws_vpc_endpoint.native_preparation_kms[0].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-development-gateway-lambda"])
    error_message = "Private DNS KMS endpoint must admit the original Gateway only for packet keys."
  }
}
run "candidate_flow_enabled" {
  command = plan
  variables { gateway_native_materials = { packet_protection_enabled = true, read_authorizations_enabled = true, cover_letter_base_host = "letters.example.com", cover_letter_locations_enabled = true, resume_base_host = "resumes.example.com", resume_locations_enabled = true, resume_preparation_enabled = true, cover_letter_preparation_enabled = true } }
  assert {
    condition     = alltrue([for key, value in local.gateway_native_material_environment : aws_lambda_function.gateway[0].environment[0].variables[key] == value]) && local.gateway_native_material_environment.NATIVE_MATERIAL_BASE_HOST == "letters.example.com" && local.gateway_native_material_environment.NATIVE_RESUME_BASE_HOST == "resumes.example.com" && local.gateway_native_material_environment.NATIVE_RESUME_PREPARATION_ENABLED == "true" && local.gateway_native_material_environment.NATIVE_COVER_LETTER_PREPARATION_ENABLED == "true"
    error_message = "Enabled flow must reach the actual Gateway environment with separate reviewed native hosts."
  }
}

run "missing_keys" {
  command = plan
  variables {
    restricted_packet_keys_provisioned = false
    gateway_native_materials           = {}
  }
  expect_failures = [var.gateway_native_materials]
}

run "authorization_without_protection" {
  command = plan
  variables { gateway_native_materials = { read_authorizations_enabled = true } }
  expect_failures = [var.gateway_native_materials]
}

run "location_without_authorization" {
  command = plan
  variables { gateway_native_materials = { cover_letter_base_host = "letters.example.com", cover_letter_locations_enabled = true } }
  expect_failures = [var.gateway_native_materials]
}

run "intake_without_location" {
  command = plan
  variables { gateway_native_materials = { packet_protection_enabled = true, resume_preparation_enabled = true } }
  expect_failures = [var.gateway_native_materials]
}

run "url_instead_of_host" {
  command = plan
  variables { gateway_native_materials = { resume_base_host = "https://resumes.example.com" } }
  expect_failures = [var.gateway_native_materials]
}

run "cover_letter_intake_without_location" {
  command = plan
  variables { gateway_native_materials = { packet_protection_enabled = true, cover_letter_preparation_enabled = true } }
  expect_failures = [var.gateway_native_materials]
}

run "availability_without_network" {
  command = plan
  variables { gateway_native_materials = { availability_enabled = true, packet_protection_enabled = true, read_authorizations_enabled = true, cover_letter_locations_enabled = true, cover_letter_base_host = "letters.example.com" } }
  expect_failures = [var.gateway_native_materials]
}
run "availability_network" {
  command = plan
  variables {
    private_application_networking = true
    native_material_read_networks  = { cover_letter = {} }
    gateway_native_materials       = { availability_enabled = true, packet_protection_enabled = true, read_authorizations_enabled = true, cover_letter_locations_enabled = true, cover_letter_base_host = "letters.example.com" }
  }
  override_resource {
    target          = aws_eip.nat[0]
    override_during = plan
    values          = { public_ip = "198.51.100.7" }
  }
  assert {
    condition     = local.gateway_native_material_environment.NATIVE_MATERIAL_AVAILABILITY_ENABLED == "true" && toset(local.native_material_read_cidrs.cover_letter) == toset(["198.51.100.7/32"])
    error_message = "Availability requires exact NAT source access to the native HTTPS task group."
  }
}

run "disposal_without_retained_deployment" {
  command = plan
  variables { gateway_native_materials = { disposal_enabled = true } }
  expect_failures = [var.gateway_native_materials]
}
run "disposal_exact_task_authority" {
  command = plan
  variables { gateway_native_materials = {
    disposal_enabled     = true
    disposal_deployments = [{ cluster_arn = "arn:aws:ecs:us-east-2:111122223333:cluster/native-materials", task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:7", container_name = "native-material" }]
  } }
  assert {
    condition     = local.gateway_native_material_environment.NATIVE_APPLICATION_DISPOSAL_ENABLED == "true" && length(aws_iam_role_policy.gateway_native_disposal) == 1 && length(aws_vpc_endpoint.native_resume_api) == 1 && toset(local.gateway_disposal_statements[0].Action) == toset(["ecs:DescribeTasks", "ecs:StopTask"]) && local.gateway_disposal_statements[0].Resource == "arn:aws:ecs:us-east-2:111122223333:task/native-materials/*" && local.gateway_disposal_statements[0].Condition.ArnEquals["ecs:cluster"] == "arn:aws:ecs:us-east-2:111122223333:cluster/native-materials"
    error_message = "Terminal cleanup needs private ECS reachability and exact retained cluster task authority."
  }
}
run "disposal_foreign_cluster" {
  command = plan
  variables { gateway_native_materials = { disposal_deployments = [{ cluster_arn = "arn:aws:ecs:us-east-2:999900001111:cluster/native-materials", task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:7", container_name = "native-material" }] } }
  expect_failures = [var.gateway_native_materials]
}

run "owner_withdrawal_requires_scheduled_cleanup" {
  command = plan
  variables {
    gateway_native_materials = {
      owner_cleanup_enabled = true
      disposal_enabled      = true
      disposal_deployments  = [{ cluster_arn = "arn:aws:ecs:us-east-2:111122223333:cluster/synthetic", task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:7", container_name = "native-material" }]
    }
  }
  expect_failures = [var.gateway_native_materials]
}

run "legacy_replay_is_decrypt_only" {
  command = plan
  override_resource {
    target          = aws_kms_key.legacy_receipt_encryption[0]
    override_during = plan
    values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/42345678-1234-4234-8234-123456789012" }
  }
  variables {
    legacy_receipt_key_provisioned = true
    legacy_receipt_replay_enabled  = true
    gateway_native_materials       = { packet_protection_enabled = true }
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.legacy_receipt_replay[0].policy).Statement[0].Action == ["kms:Decrypt"] && jsondecode(aws_iam_role_policy.legacy_receipt_replay[0].policy).Statement[0].Resource == aws_kms_key.legacy_receipt_encryption[0].arn && jsondecode(aws_iam_role_policy.legacy_receipt_replay[0].policy).Statement[0].Condition.StringEquals["kms:EncryptionContext:purpose"] == "restricted-legacy-application-receipt.v1"
    error_message = "Replay must only decrypt the exact legacy key for its receipt purpose."
  }
  assert {
    condition     = length(aws_ecs_task_definition.legacy_receipt_transition) == 0 && aws_lambda_function.gateway[0].environment[0].variables.LEGACY_RECEIPT_REPLAY_ENABLED == "true" && aws_lambda_function.gateway[0].environment[0].variables.LEGACY_RECEIPT_ENCRYPTION_KEY_ARN == aws_kms_key.legacy_receipt_encryption[0].arn
    error_message = "Gateway replay must compose the key without creating a maintenance task."
  }
  assert {
    condition     = length(jsondecode(aws_vpc_endpoint.native_preparation_kms[0].policy).Statement) == 3 && alltrue([for statement in local.legacy_receipt_endpoint_statements : statement.Action == ["kms:Decrypt"] && statement.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-development-gateway-lambda"])
    error_message = "Private KMS reachability must preserve both packet grants and bind receipt decryption to the Gateway."
  }
}
run "legacy_replay_requires_packet_protection" {
  command = plan
  variables {
    legacy_receipt_key_provisioned = true
    legacy_receipt_replay_enabled  = true
  }
  expect_failures = [var.legacy_receipt_replay_enabled]
}
