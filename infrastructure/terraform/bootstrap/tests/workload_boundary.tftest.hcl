mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { name = "us-east-2" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
}

mock_provider "tls" {
  mock_data "tls_certificate" {
    defaults = {
      certificates = [{
        sha1_fingerprint = "0123456789abcdef0123456789abcdef01234567"
      }]
    }
  }
}

variables {
  environment        = "staging"
  state_bucket_name  = "ai-job-apply-staging-state-test"
  github_environment = "staging"
}

run "public_reader_boundary_is_username_and_account_scoped" {
  command = plan

  assert {
    condition = one([
      for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement
      if statement.Sid == "ConnectExactPublicJobReader"
    ]).Action == ["rds-db:connect"]
    error_message = "The workload boundary must allow only rds-db:connect in the public-reader statement."
  }

  assert {
    condition = one([
      for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement
      if statement.Sid == "ConnectExactPublicJobReader"
    ]).Resource == "arn:aws:rds-db:us-east-2:111122223333:dbuser:*/ai_job_apply_public_job_reader"
    error_message = "The boundary must freeze the exact account, region, and public-reader username."
  }
}
