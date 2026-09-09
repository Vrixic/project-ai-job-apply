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

run "restore_reads_default_absent" {
  command = plan
  assert {
    condition     = length([for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement if startswith(statement.Sid, "RestoreOnly")]) == 0
    error_message = "The retained-version restore allowance must remain absent by default."
  }
}

run "restore_reads_only_exact_development_role" {
  command = plan
  variables {
    environment                             = "development"
    candidate_deletion_restore_role_enabled = true
  }
  assert {
    condition     = alltrue([for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-development-deletion-restore" if startswith(statement.Sid, "RestoreOnly")])
    error_message = "No existing role may inherit the new retained-version reads."
  }
  assert {
    condition     = one([for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement if statement.Sid == "RestoreOnlyReadRetainedVersions"]).Action == ["s3:GetObjectVersion", "s3:GetObjectRetention"]
    error_message = "Restore boundary additions must never include a mutation or wildcard action."
  }
}

run "staging_restore_boundary_rejected" {
  command = plan
  variables { candidate_deletion_restore_role_enabled = true }
  expect_failures = [var.candidate_deletion_restore_role_enabled]
}
