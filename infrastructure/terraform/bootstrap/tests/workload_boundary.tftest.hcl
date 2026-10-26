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

run "notification_email_fits_the_boundary" {
  command = plan

  assert {
    condition = one([
      for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement
      if statement.Sid == "SendEmail"
    ]) == { Sid = "SendEmail", Effect = "Allow", Action = ["ses:SendEmail"], Resource = "arn:aws:ses:us-east-2:111122223333:*" }
    error_message = "The boundary must allow ses:SendEmail only inside this account and region, or the dispatcher role is silently denied."
  }

  assert {
    condition     = length([for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement if contains(statement.Action, "xray:PutTraceSegments") && contains(statement.Action, "ecr:GetAuthorizationToken")]) == 1
    error_message = "Trace writing and ECR authorization must stay in the boundary."
  }
}

run "durable_execution_status_reads_fit_the_boundary" {
  command = plan

  assert {
    condition = contains(one([
      for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement
      if statement.Sid == "OperateOwnedServerlessWorkflows"
    ]).Action, "lambda:GetDurableExecution")
    error_message = "The boundary must allow lambda:GetDurableExecution, or the ingestion coordinator is silently denied when it reads an execution status."
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
    condition     = one([for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement if statement.Sid == "RestoreOnlyReadRetainedVersions"]).Action == ["s3:ListBucketVersions", "s3:GetObjectVersion", "s3:GetObjectRetention"]
    error_message = "Restore boundary additions must never include a mutation or wildcard action."
  }
  assert {
    condition     = length([for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement if startswith(statement.Sid, "RestoreOnly")]) == 1 && one([for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement if statement.Sid == "RestoreOnlyReadRetainedVersions"]).Resource == ["arn:aws:s3:::ai-job-apply-development-candidate-del-recovery-*", "arn:aws:s3:::ai-job-apply-development-candidate-del-recovery-*/candidate-deletion-recovery/*"]
    error_message = "Restore reads must stay limited to the retained recovery bucket and its marker prefix."
  }
}

run "restore_reads_fit_complete_development_boundary" {
  command = plan
  variables {
    environment                             = "development"
    github_environment                      = "development"
    state_bucket_name                       = "ai-job-apply-development-terraform-state-111122223333"
    candidate_deletion_restore_role_enabled = true
    gateway_packet_fingerprint_key_arn      = "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012"
    gateway_native_disposal_clusters        = ["arn:aws:ecs:us-east-2:111122223333:cluster/ai-job-apply-development"]
    native_cleanup_clusters                 = ["arn:aws:ecs:us-east-2:111122223333:cluster/ai-job-apply-development"]
  }
  assert {
    condition     = length(aws_iam_policy.workload_boundary.policy) <= 6144
    error_message = "The complete development boundary with restore reads must fit the IAM managed-policy size limit."
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
  assert {
    condition     = alltrue([for statement in jsondecode(aws_iam_policy.native_resume_observer_boundary["7"].policy).Statement : statement.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-staging-resume-observer-r7" && !contains(statement.Action, "ecs:RunTask") && !contains(statement.Action, "ecs:StopTask") && !contains(statement.Action, "iam:PassRole")])
    error_message = "Observer ceiling must remain principal-bound with no launch, stop or PassRole."
  }
  variables {
    native_resume_control_releases = { "7" = {
      observer_dead_letter_arn = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-resume-observation-dlq"
      cluster_name             = "native-resume"
      database_secret_arn      = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123"
      platform_kms_key_arn     = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012"
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
      observer_dead_letter_arn = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-resume-observation-dlq"
      cluster_name             = "native-resume"
      database_secret_arn      = "arn:aws:secretsmanager:us-east-2:999900001111:secret:ai-job-apply/staging/database-Abc123"
      platform_kms_key_arn     = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012"
    } }
  }
  expect_failures = [var.native_resume_control_releases]
}

run "original_route_boundary" {
  command = plan
  variables {
    native_resume_control_releases = { "7" = {
      observer_dead_letter_arn = "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-resume-observation-dlq"
      cluster_name             = "native-resume"
      database_secret_arn      = "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123"
      platform_kms_key_arn     = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012"
      route                    = { hosted_zone_id = "ZSYNTHETIC", base_host = "resume.example.com" }
    } }
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_policy.native_resume_durable_boundary["7"].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-staging-resume-durable-r7" && !contains(s.Action, "ecs:RunTask") && !contains(s.Action, "secretsmanager:GetSecretValue")]) && length(aws_iam_policy.native_resume_durable_boundary["7"].policy) <= 6144 && length(jsonencode(local.github_deploy_policy)) <= 6144
    error_message = "DNS ceiling must remain original-principal-only, content-free and within IAM limits."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.native_resume_durable_boundary["7"].policy).Statement : s if s.Sid == "OriginalRecords"]).Condition["ForAllValues:StringEquals"]["route53:ChangeResourceRecordSetsActions"] == ["CREATE", "DELETE"] && length([for s in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : s if contains(s.Action, "route53:ChangeResourceRecordSets")]) == 0
    error_message = "Original DNS permissions must exclude UPSERT and leave the shared ceiling unchanged."
  }
}

run "candidate_rights_version_cleanup_is_activity_and_prefix_scoped" {
  command = plan
  variables { environment = "development" }

  assert {
    condition = one([
      for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement
      if statement.Sid == "ListCandidateDataExportVersions"
      ]) == {
      Sid      = "ListCandidateDataExportVersions"
      Effect   = "Allow"
      Action   = ["s3:ListBucketVersions"]
      Resource = "arn:aws:s3:::ai-job-apply-development-candidate-exports-111122223333"
      Condition = {
        ArnEquals = {
          "aws:PrincipalArn" = "arn:aws:iam::111122223333:role/ai-job-apply-development-profile-readiness-activity"
        }
        StringLike = { "s3:prefix" = "candidate-data-exports/*" }
      }
    }
    error_message = "Export version inventory must be a read-only ceiling for the exact account bucket, activity role and owner export prefix."
  }

  assert {
    condition = one([
      for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement
      if statement.Sid == "PurgeDeletedCandidateDocumentVersions"
      ]) == {
      Sid      = "PurgeDeletedCandidateDocumentVersions"
      Effect   = "Allow"
      Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
      Resource = "arn:aws:s3:::ai-job-apply-development-candidate-docs-*/*"
      Condition = {
        ArnEquals = {
          "aws:PrincipalArn" = "arn:aws:iam::111122223333:role/ai-job-apply-development-profile-readiness-activity"
        }
      }
    }
    error_message = "Versioned DeleteObjects must retain the exact activity principal and existing document object resources."
  }

  assert {
    condition = length([
      for statement in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : statement
      if contains(statement.Action, "s3:DeleteObject")
    ]) == 1
    error_message = "No other shared workload statement may gain document delete authority."
  }

  assert {
    condition     = length(aws_iam_policy.workload_boundary.policy) <= 6144
    error_message = "The complete rendered workload boundary must fit the AWS managed policy size limit."
  }
}
