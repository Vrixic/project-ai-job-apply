mock_provider "aws" {
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:us-east-2:111122223333:ai-job-apply-development-operations" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012" } }

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


override_resource {
  override_during = plan
  target          = aws_security_group.application
  values          = { id = "sg-aaaaaaaaaaaaaaaaa" }
}
run "absent" {
  command = plan
  assert {
    condition     = !local.material_private_configured && length(aws_vpc_endpoint.native_resume_api) == 0 && length(local.material_secret_access) == 0
    error_message = "Absent material releases must not add access or endpoints."
  }
}
run "connected_with_resume" {
  command = plan
  variables {
    native_material_control_network = { m1 = {
      address_lookup      = true
      task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:3"
      cluster_arn         = "arn:aws:ecs:us-east-2:111122223333:cluster/material"
      database_secret_arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-abc123"
      security_group_ids  = ["sg-11111111111111111"]
    } }
    native_material_task_access = { "3" = {
      owner_function_arn         = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:9"
      provider_secret_arn        = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/provider-abc123"
      provider_secret_version_id = "12345678-1234-4234-8234-123456789012"
      tls_secret_arn             = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-abc123"
      tls_secret_version_id      = "22345678-1234-4234-8234-123456789012"
      security_group_ids         = ["sg-22222222222222222"]
    } }
    native_resume_control_network = { "7" = {
      cluster_arn        = "arn:aws:ecs:us-east-2:111122223333:cluster/resume"
      security_group_ids = ["sg-33333333333333333"]
      address_lookup     = true
    } }
  }
  assert {
    condition     = length(jsondecode(aws_vpc_endpoint.native_resume_api["ec2"].policy).Statement) == 2 && one([for s in jsondecode(aws_vpc_endpoint.native_resume_api["ec2"].policy).Statement : s if s.Sid == "MaterialAddressm1"]).Condition.ArnEquals["aws:PrincipalArn"] == local.material_control_roles.m1.launch
    error_message = "Only the original material launcher joins the shared address lookup endpoint."
  }
  assert {
    condition     = toset(keys(aws_vpc_endpoint.native_resume_api)) == toset(["ecs", "ec2"]) && length(aws_vpc_endpoint.lambda) == 1 && length(aws_vpc_endpoint.secretsmanager) == 1 && length(jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement) == 6
    error_message = "Resume and material must share one private DNS endpoint per service."
  }
  assert {
    condition     = one(aws_security_group.data.ingress).security_groups == toset(["sg-aaaaaaaaaaaaaaaaa", "sg-11111111111111111"]) && one(aws_security_group.native_resume_api[0].ingress).security_groups == toset(["sg-11111111111111111", "sg-33333333333333333"]) && contains(one(aws_security_group.secrets_endpoint[0].ingress).security_groups, "sg-22222222222222222")
    error_message = "Task reaches secrets/RPC but neither SQL nor ECS; controls reach SQL/ECS."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == local.material_control_roles.m1.launch if startswith(s.Sid, "Material")]) && one([for s in jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement : s if s.Sid == "MaterialLaunchm1"]).Resource == var.native_material_control_network.m1.task_definition_arn && one([for s in jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement : s if s.Sid == "MaterialLaunchm1"]).Condition.Bool["ecs:enable-execute-command"] == "false"
    error_message = "Only original material launcher may inspect/launch its bound tasks, without ECS exec."
  }
  assert {
    condition     = length([for s in data.aws_iam_policy_document.secrets_endpoint[0].statement : s if startswith(s.sid, "MaterialSecret")]) == 4 && alltrue([for s in data.aws_iam_policy_document.secrets_endpoint[0].statement : s.actions == toset(["secretsmanager:GetSecretValue"]) && length(s.resources) == 1 && length(s.condition) == (startswith(s.sid, "MaterialSecretTask") ? 2 : 1) if startswith(s.sid, "MaterialSecret")])
    error_message = "Controls get only DB secrets; tasks require pinned provider/TLS versions."
  }
  assert {
    condition     = one(one([for s in data.aws_iam_policy_document.secrets_endpoint[0].statement : s if s.sid == "MaterialSecretTask3Provider"]).resources) == var.native_material_task_access["3"].provider_secret_arn && one(one([for c in one([for s in data.aws_iam_policy_document.secrets_endpoint[0].statement : s if s.sid == "MaterialSecretTask3Provider"]).condition : c if c.variable == "secretsmanager:VersionId"]).values) == var.native_material_task_access["3"].provider_secret_version_id
    error_message = "Provider read must enforce the original immutable version."
  }
  assert {
    condition     = one(one([for s in data.aws_iam_policy_document.outbox_lambda_endpoint[0].statement : s if s.sid == "MaterialOwnerRpc3"]).resources) == var.native_material_task_access["3"].owner_function_arn && one(one(one([for s in data.aws_iam_policy_document.outbox_lambda_endpoint[0].statement : s if s.sid == "MaterialOwnerRpc3"]).condition).values) == local.material_task_roles["3"]
    error_message = "Task RPC is restricted to its original numeric owner and task principal."
  }
}
run "task_registration_before_control" {
  command = plan
  variables {
    native_material_task_access = { "3" = {
      owner_function_arn         = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:9"
      provider_secret_arn        = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/provider-abc123"
      provider_secret_version_id = "12345678-1234-4234-8234-123456789012"
      tls_secret_arn             = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-abc123"
      tls_secret_version_id      = "22345678-1234-4234-8234-123456789012"
      security_group_ids         = []
    } }
  }
  assert {
    condition     = length(aws_vpc_endpoint.native_resume_api) == 0 && length(local.material_task_groups) == 0 && length(local.material_secret_access) == 2
    error_message = "Task registration alone must not admit SQL/ECS or invent task source groups."
  }
}
run "foreign_control_refused" {
  command = plan
  variables {
    native_material_control_network = { m1 = {
      task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:3"
      cluster_arn         = "arn:aws:ecs:us-east-2:999900001111:cluster/material"
      database_secret_arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-abc123"
      security_group_ids  = ["sg-11111111111111111"]
    } }
  }
  expect_failures = [var.native_material_control_network]
}
run "owner_alias_refused" {
  command = plan
  variables {
    native_material_task_access = { "3" = {
      owner_function_arn         = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:live"
      provider_secret_arn        = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/provider-abc123"
      provider_secret_version_id = "12345678-1234-4234-8234-123456789012"
      tls_secret_arn             = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-abc123"
      tls_secret_version_id      = "22345678-1234-4234-8234-123456789012"
      security_group_ids         = ["sg-22222222222222222"]
    } }
  }
  expect_failures = [var.native_material_task_access]
}
run "task_sql_group_refused" {
  command = plan
  variables {
    native_material_control_network = { m1 = {
      task_definition_arn = "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-material:3"
      cluster_arn         = "arn:aws:ecs:us-east-2:111122223333:cluster/material"
      database_secret_arn = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-abc123"
      security_group_ids  = ["sg-11111111111111111"]
    } }
    native_material_task_access = { "3" = {
      owner_function_arn         = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:9"
      provider_secret_arn        = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/provider-abc123"
      provider_secret_version_id = "12345678-1234-4234-8234-123456789012"
      tls_secret_arn             = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-abc123"
      tls_secret_version_id      = "22345678-1234-4234-8234-123456789012"
      security_group_ids         = ["sg-11111111111111111"]
    } }
  }
  expect_failures = [aws_security_group.secrets_endpoint]
}
run "task_shared_application_group_refused" {
  command = plan
  variables {
    native_material_task_access = { "3" = {
      owner_function_arn         = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-owner-m1:9"
      provider_secret_arn        = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/provider-abc123"
      provider_secret_version_id = "12345678-1234-4234-8234-123456789012"
      tls_secret_arn             = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/tls-abc123"
      tls_secret_version_id      = "22345678-1234-4234-8234-123456789012"
      security_group_ids         = ["sg-aaaaaaaaaaaaaaaaa"]
    } }
  }
  expect_failures = [aws_security_group.secrets_endpoint]
}
