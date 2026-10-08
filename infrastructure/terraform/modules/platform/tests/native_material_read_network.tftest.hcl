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

run "default_absent" {
  command = plan
  assert {
    condition     = length(aws_security_group.native_material_read) == 0 && length(output.native_material_read_network_bindings) == 0
    error_message = "Default environment must not provision native public task ingress."
  }
}
run "provisioned_closed" {
  command = plan
  variables { native_material_read_networks = { cover_letter = {}, resume = {} } }
  assert {
    condition     = length(aws_security_group.native_material_read) == 2 && alltrue([for group in aws_security_group.native_material_read : length(group.ingress) == 0 && length(group.egress) == 1 && one(group.egress).from_port == 443 && one(group.egress).to_port == 443 && one(group.egress).protocol == "tcp"])
    error_message = "Task groups must be separate and closed until client ranges are selected, with TLS-only egress."
  }
  assert {
    condition     = length(aws_nat_gateway.this) == 0
    error_message = "Network provisioning cannot create NAT or launch a material task."
  }
}
run "bounded_read_clients" {
  command = plan
  variables { native_material_read_networks = { cover_letter = { client_ipv4_cidrs = ["203.0.113.7/32"] }, resume = { client_ipv4_cidrs = ["198.51.100.0/24"] } } }
  override_resource {
    target          = aws_security_group.native_material_read["cover_letter"]
    override_during = plan
    values          = { id = "sg-bbbbbbbbbbbbbbbbb" }
  }
  override_resource {
    target          = aws_security_group.native_material_read["resume"]
    override_during = plan
    values          = { id = "sg-ccccccccccccccccc" }
  }
  assert {
    condition     = alltrue([for group in aws_security_group.native_material_read : one(group.ingress).from_port == 8443 && one(group.ingress).to_port == 8443 && one(group.ingress).protocol == "tcp" && length(one(group.ingress).ipv6_cidr_blocks) == 0 && length(one(group.ingress).security_groups) == 0]) && toset(one(aws_security_group.native_material_read["cover_letter"].ingress).cidr_blocks) == toset(["203.0.113.7/32"])
    error_message = "Only reviewed IPv4 clients may reach the fixed HTTPS read port."
  }
  assert {
    condition     = !contains(one(aws_security_group.data.ingress).security_groups, "sg-bbbbbbbbbbbbbbbbb") && !contains(one(aws_security_group.data.ingress).security_groups, "sg-ccccccccccccccccc") && length(aws_security_group.application.ingress) == 0
    error_message = "Native read groups must not gain SQL access or open application Lambda ingress."
  }
  assert {
    condition     = output.native_material_read_network_bindings.cover_letter.task_security_group_ids == ["sg-bbbbbbbbbbbbbbbbb"] && output.native_material_read_network_bindings.resume.task_security_group_ids == ["sg-ccccccccccccccccc"] && output.native_material_read_network_bindings.cover_letter.assign_public_ip == "ENABLED" && output.native_material_read_network_bindings.resume.port == 8443 && length(output.native_material_read_network_bindings.cover_letter.task_subnet_ids) == 2
    error_message = "Outputs must bind each isolated task group to existing public subnets and explicit task public-IP mode."
  }
}
run "public_read_requires_explicit_range" {
  command = plan
  variables { native_material_read_networks = { cover_letter = { client_ipv4_cidrs = ["0.0.0.0/0"] } } }
  assert {
    condition     = toset(one(aws_security_group.native_material_read["cover_letter"].ingress).cidr_blocks) == toset(["0.0.0.0/0"]) && length(aws_security_group.native_material_read) == 1
    error_message = "Explicit public read selection must not create another task group's ingress."
  }
}
run "ipv6_rejected" {
  command = plan
  variables { native_material_read_networks = { resume = { client_ipv4_cidrs = ["::/0"] } } }
  expect_failures = [var.native_material_read_networks]
}
run "noncanonical_range_rejected" {
  command = plan
  variables { native_material_read_networks = { cover_letter = { client_ipv4_cidrs = ["203.0.113.7/24"] } } }
  expect_failures = [var.native_material_read_networks]
}
run "unknown_kind_rejected" {
  command = plan
  variables { native_material_read_networks = { application = {} } }
  expect_failures = [var.native_material_read_networks]
}

run "native_image_pull_preserves_migration_isolation" {
  command = plan
  variables {
    migration_image = "111122223333.dkr.ecr.us-east-2.amazonaws.com/ai-job-apply/migration@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    native_material_image_access = {
      material-r7 = {
        execution_role_arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-native-material-r7-execution"
        repository_arn     = "arn:aws:ecr:us-east-2:111122223333:repository/ai-job-apply/native-material"
        security_group_ids = ["sg-bbbbbbbbbbbbbbbbb"]
      }
      resume-r8 = {
        execution_role_arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-native-resume-r8-execution"
        repository_arn     = "arn:aws:ecr:us-east-2:111122223333:repository/ai-job-apply/native-resume"
        security_group_ids = ["sg-ccccccccccccccccc"]
      }
    }
  }
  override_resource {
    target          = aws_security_group.native_material_image_endpoint[0]
    override_during = plan
    values          = { id = "sg-ddddddddddddddddd" }
  }
  override_resource {
    target          = aws_security_group.migration_aws_endpoints[0]
    override_during = plan
    values          = { id = "sg-eeeeeeeeeeeeeeeee" }
  }
  assert {
    condition     = toset(aws_vpc_endpoint.migration_ecr_api[0].security_group_ids) == toset(["sg-ddddddddddddddddd", "sg-eeeeeeeeeeeeeeeee"]) && toset(aws_vpc_endpoint.migration_ecr_dkr[0].security_group_ids) == toset(["sg-ddddddddddddddddd", "sg-eeeeeeeeeeeeeeeee"]) && toset(aws_vpc_endpoint.migration_logs[0].security_group_ids) == toset(["sg-eeeeeeeeeeeeeeeee"])
    error_message = "Only ECR endpoints may admit the native task endpoint group; logs must remain migration-only."
  }
  assert {
    condition     = one(aws_security_group.native_material_image_endpoint[0].ingress).from_port == 443 && one(aws_security_group.native_material_image_endpoint[0].ingress).to_port == 443 && toset(one(aws_security_group.native_material_image_endpoint[0].ingress).security_groups) == toset(["sg-bbbbbbbbbbbbbbbbb", "sg-ccccccccccccccccc"]) && toset(one(aws_security_group.migration_aws_endpoints[0].ingress).security_groups) == toset(["sg-aaaaaaaaaaaaaaaaa"])
    error_message = "Native image access must use exact task groups without broadening the migration endpoint group."
  }
  assert {
    condition     = length(data.aws_iam_policy_document.migration_ecr_endpoint[0].statement) == 6 && alltrue([for id, access in var.native_material_image_access : length([for s in data.aws_iam_policy_document.migration_ecr_endpoint[0].statement : s if s.sid == "NativeRepositoryPull${replace(id, "-", "")}" && toset(s.resources) == toset([access.repository_arn]) && toset(s.actions) == toset(["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]) && one(s.principals).type == "AWS" && toset(one(s.principals).identifiers) == toset([access.execution_role_arn])]) == 1 && length([for s in data.aws_iam_policy_document.migration_ecr_endpoint[0].statement : s if s.sid == "NativeRegistryAuthorization${replace(id, "-", "")}" && toset(s.resources) == toset(["*"]) && toset(s.actions) == toset(["ecr:GetAuthorizationToken"]) && toset(one(s.principals).identifiers) == toset([access.execution_role_arn])]) == 1])
    error_message = "Native image pulls require exact original execution principals and repository resources, with wildcard resource only for registry authorization."
  }
}

run "foreign_image_account_rejected" {
  command = plan
  variables {
    native_material_image_access = { material-r7 = {
      execution_role_arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-native-material-r7-execution"
      repository_arn     = "arn:aws:ecr:us-east-2:999922223333:repository/ai-job-apply/native-material"
      security_group_ids = []
    } }
  }
  expect_failures = [var.native_material_image_access]
}

run "different_execution_role_rejected" {
  command = plan
  variables {
    native_material_image_access = { resume-r8 = {
      execution_role_arn = "arn:aws:iam::111122223333:role/ai-job-apply-development-native-resume-r9-execution"
      repository_arn     = "arn:aws:ecr:us-east-2:111122223333:repository/ai-job-apply/native-resume"
      security_group_ids = []
    } }
  }
  expect_failures = [var.native_material_image_access]
}
