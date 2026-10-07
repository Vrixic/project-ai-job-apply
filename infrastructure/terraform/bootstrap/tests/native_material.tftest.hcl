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


run "absent" {
  command = plan
  assert {
    condition     = length(aws_iam_policy.native_material_control_boundary) == 0 && local.additional_runtime_boundary_arns == []
    error_message = "Default adds no launcher authority."
  }
}
run "original_launcher_ceiling" {
  command = plan
  variables { native_material_control_releases = { r1 = { "task_revision" : "7", "cluster_name" : "ai-job-apply-staging-native", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } } }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_policy.native_material_control_boundary["r1"].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == local.native_material_controls.r1.principal]) && one([for s in jsondecode(aws_iam_policy.native_material_control_boundary["r1"].policy).Statement : s if s.Sid == "OriginalLaunch"]).Resource == local.native_material_controls.r1.task
    error_message = "Every capability belongs only to the original launcher and exact task."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.native_material_control_boundary["r1"].policy).Statement : s if s.Sid == "OriginalRoles"]).Resource == local.native_material_controls.r1.roles && alltrue([for s in jsondecode(aws_iam_policy.native_material_control_boundary["r1"].policy).Statement : !contains(s.Action, "ecs:StopTask") && !contains(s.Action, "s3:GetObject") && !contains(s.Action, "lambda:InvokeFunction")])
    error_message = "Ceiling must not grant stop, content access, Lambda invocation or foreign PassRole."
  }
  assert {
    condition     = contains(one([for s in local.github_deploy_policy.Statement : s if s.Sid == "ReadApprovedPolicies"]).Resource, local.native_material_controls.r1.boundary) && length(jsonencode(local.github_deploy_policy)) <= 6144
    error_message = "Deployment admits the exact ceiling and fits IAM."
  }
}
run "foreign_database_refused" {
  command = plan
  variables { native_material_control_releases = { r1 = { "task_revision" : "7", "cluster_name" : "ai-job-apply-staging-native", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:999900001111:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } } }
  expect_failures = [var.native_material_control_releases]
}
run "all_original_families_coexist" {
  command = plan
  variables {
    native_material_control_releases = { r1 = { "task_revision" : "7", "cluster_name" : "ai-job-apply-staging-native", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } }
    native_preparation_releases      = { r1 = { "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-native-launch:9", "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation-dlq", "queue_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } }
    native_resume_control_releases   = { "7" = { "observer_dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-resume-dlq", "cluster_name" : "native-resume", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "route" : { "hosted_zone_id" : "ZSYNTHETIC", "base_host" : "resume.example.com" } } }
  }
  assert {
    condition     = length(jsonencode(local.github_deploy_policy)) <= 6144
    error_message = "Combined preparation and resume deployment ceiling must fit IAM."
  }
}
