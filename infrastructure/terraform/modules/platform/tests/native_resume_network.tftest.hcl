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


run "empty_creates_no_api_endpoints" {
  command = plan
  assert {
    condition     = length(aws_vpc_endpoint.native_resume_api) == 0 && length(aws_security_group.native_resume_api) == 0
    error_message = "Absent release configuration must add no resources."
  }
}
run "original_private_control" {
  command = plan
  variables {
    native_resume_control_network = { "7" = {
      cluster_arn        = "arn:aws:ecs:us-east-2:111122223333:cluster/native-resume"
      security_group_ids = ["sg-0123456789abcdef0"]
      address_lookup     = true
    } }
  }
  assert {
    condition     = toset(keys(aws_vpc_endpoint.native_resume_api)) == toset(["ecs", "ec2"]) && alltrue([for endpoint in aws_vpc_endpoint.native_resume_api : endpoint.private_dns_enabled && length(endpoint.subnet_ids) == 1]) && one(aws_security_group.native_resume_api[0].ingress).security_groups == toset(["sg-0123456789abcdef0"])
    error_message = "Only original source groups may reach the private API endpoints."
  }
  assert {
    condition     = jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement[0].Resource == "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-development-native-resume:7" && jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement[0].Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-development-resume-control-r7" && jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement[0].Condition.Bool["ecs:enable-execute-command"] == "false"
    error_message = "Launch must remain original-task/control/cluster scoped and exclude exec."
  }
  assert {
    condition     = toset(jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement[2].Condition.ArnEquals["aws:PrincipalArn"]) == toset(["arn:aws:iam::111122223333:role/ai-job-apply-development-resume-control-r7", "arn:aws:iam::111122223333:role/ai-job-apply-development-resume-observer-r7"]) && jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement[2].Action == ["ecs:DescribeTasks"] && jsondecode(aws_vpc_endpoint.native_resume_api["ecs"].policy).Statement[2].Condition.ArnEquals["ecs:cluster"] == "arn:aws:ecs:us-east-2:111122223333:cluster/native-resume"
    error_message = "Observer can describe original tasks, never launch or stop them."
  }
  assert {
    condition     = jsondecode(aws_vpc_endpoint.native_resume_api["ec2"].policy).Statement[0].Action == ["ec2:DescribeNetworkInterfaces"] && jsondecode(aws_vpc_endpoint.native_resume_api["ec2"].policy).Statement[0].Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-development-resume-control-r7"
    error_message = "Address lookup must be metadata-only and control-only."
  }
}
run "launch_without_route_needs_only_ecs" {
  command = plan
  variables {
    native_resume_control_network = { "7" = {
      cluster_arn        = "arn:aws:ecs:us-east-2:111122223333:cluster/native-resume"
      security_group_ids = ["sg-0123456789abcdef0"]
    } }
  }
  assert {
    condition     = toset(keys(aws_vpc_endpoint.native_resume_api)) == toset(["ecs"])
    error_message = "Do not provision an unused EC2 endpoint."
  }
}
run "dormant_does_not_provision_endpoints" {
  command = plan
  variables {
    persistent_data_plane_enabled = false
    database_deletion_protection  = false
    native_resume_control_network = { "7" = {
      cluster_arn        = "arn:aws:ecs:us-east-2:111122223333:cluster/native-resume"
      security_group_ids = ["sg-0123456789abcdef0"]
      address_lookup     = true
    } }
  }
  assert {
    condition     = length(aws_vpc_endpoint.native_resume_api) == 0 && length(aws_security_group.native_resume_api) == 0
    error_message = "Dormant data plane must not add API endpoints."
  }
}
run "foreign_cluster_rejected" {
  command = plan
  variables {
    native_resume_control_network = { "7" = {
      cluster_arn        = "arn:aws:ecs:us-east-2:999988887777:cluster/native-resume"
      security_group_ids = ["sg-0123456789abcdef0"]
    } }
  }
  expect_failures = [var.native_resume_control_network]
}
