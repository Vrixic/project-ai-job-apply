mock_provider "aws" {
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
  mock_data "aws_region" { defaults = { region = "us-east-2", name = "us-east-2" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "111122223333" } }
  mock_data "aws_availability_zones" { defaults = { names = ["us-east-2a", "us-east-2b"] } }
  mock_data "aws_iam_policy" { defaults = { arn = "arn:aws:iam::111122223333:policy/ai-job-apply-development-workload-boundary" } }
}
mock_provider "random" {}
mock_provider "time" {}

variables {
  name        = "ai-job-apply"
  environment = "development"
  vpc_cidr    = "10.20.0.0/16"
}

run "restore_execution_defaults_absent" {
  command = plan
  assert {
    condition     = length(aws_iam_role.candidate_deletion_restore) == 0 && length(aws_iam_role_policy.candidate_deletion_restore) == 0
    error_message = "Ordinary platform plans must not create a restore-only role or execution capability."
  }
}

run "restore_role_requires_existing_rights_runtime" {
  command = plan
  variables { candidate_deletion_restore_role_enabled = true }
  expect_failures = [var.candidate_deletion_restore_role_enabled]
}

run "staging_cannot_enable_restore_role" {
  command = plan
  variables {
    environment                             = "staging"
    candidate_deletion_restore_role_enabled = true
  }
  expect_failures = [var.candidate_deletion_restore_role_enabled]
}
