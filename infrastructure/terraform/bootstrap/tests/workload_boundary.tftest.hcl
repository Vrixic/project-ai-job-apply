override_resource {
  target          = aws_kms_key.state
  override_during = plan
  values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012" }
}
override_resource {
  target          = aws_s3_bucket.state
  override_during = plan
  values          = { arn = "arn:aws:s3:::ai-job-apply-staging-state-test" }
}
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

run "native_resume_default_absent" {
  command = plan
  assert {
    condition     = length(aws_iam_policy.native_resume_control_boundary) == 0 && length(local.native_resume_deploy_statements) == 0
    error_message = "Default bootstrap must add no native launch permissions."
  }
}
run "native_resume_original_control_only" {
  command = plan
  variables {
    native_resume_control_releases = { "7" = {
      cluster_name         = "native-resume"
      database_secret_arn  = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123"
      platform_kms_key_arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012"
    } }
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_policy.native_resume_control_boundary["7"].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-staging-resume-control-r7"])
    error_message = "Every capability must remain limited to the original control principal."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.native_resume_control_boundary["7"].policy).Statement : s if s.Sid == "OriginalLaunch"]).Resource == "arn:aws:ecs:us-east-2:111122223333:task-definition/ai-job-apply-staging-native-resume:7" && one([for s in jsondecode(aws_iam_policy.native_resume_control_boundary["7"].policy).Statement : s if s.Sid == "OriginalLaunch"]).Condition.ArnEquals["ecs:cluster"] == "arn:aws:ecs:us-east-2:111122223333:cluster/native-resume"
    error_message = "The boundary must preserve the task revision and cluster restrictions."
  }
  assert {
    condition     = length([for s in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : s if contains(s.Action, "ecs:RunTask") || contains(s.Action, "iam:PassRole")]) == 0
    error_message = "Unrelated workloads must gain no native launch/pass-role ceiling."
  }
  assert {
    condition     = length(aws_iam_policy.native_resume_control_boundary["7"].policy) <= 6144 && length(jsonencode(local.github_deploy_policy)) <= 6144
    error_message = "Both managed policies must fit AWS size limits."
  }
}
run "native_resume_foreign_secret_refused" {
  command = plan
  variables {
    native_resume_control_releases = { "7" = {
      cluster_name         = "native-resume"
      database_secret_arn  = "arn:aws:secretsmanager:us-east-2:999900001111:secret:ai-job-apply/staging/database-Abc123"
      platform_kms_key_arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012"
    } }
  }
  expect_failures = [var.native_resume_control_releases]
}
