override_resource {
  target          = aws_kms_key.state
  override_during = plan
  values          = { arn = "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-1234-1234-123456789012" }
}
override_resource {
  target          = aws_s3_bucket.state
  override_during = plan
  values          = { arn = "arn:aws:s3:::ai-job-apply-development-terraform-state-111122223333" }
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
  aws_region                       = "us-east-2"
  environment                      = "development"
  state_bucket_name                = "ai-job-apply-development-terraform-state-111122223333"
  github_environment               = "development"
  native_preparation_releases      = { "r1" : { "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "route" : { "hosted_zone_id" : "ZSYNTHETIC", "base_host" : "materials.example.com" }, "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-development-material-launch-r1:1", "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-r1", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-prep-failed-r1", "queue_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } }
  native_material_control_releases = { "r1" : { "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "task_revision" : "1", "cluster_name" : "ai-job-apply-development" } }
  native_resume_control_releases   = { "1" : { "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/development/database-url-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "route" : { "hosted_zone_id" : "ZSYNTHETIC", "base_host" : "materials.example.com" }, "cluster_name" : "ai-job-apply-development", "observer_dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-development-resume-observer-r1" } }
}

run "development_all_routed_families" {
  command = plan
  assert {
    condition     = length(aws_iam_policy.github_deploy_boundary.policy) <= 6144 && aws_iam_role_policy.github_deploy.policy == aws_iam_policy.github_deploy_boundary.policy
    error_message = "All routed development families must fit the same effective deployment ceiling and grant."
  }
  assert {
    condition = toset(one([for s in local.github_deploy_policy.Statement : s.Resource if s.Sid == "ManageEnvironmentDurableStack"])) == toset([
      "arn:aws:cloudformation:us-east-2:111122223333:stack/ai-job-apply-development-profile-readiness-durable/*",
      "arn:aws:cloudformation:us-east-2:111122223333:stack/ai-job-apply-development-prep-durable-r1/*",
      "arn:aws:cloudformation:us-east-2:111122223333:stack/ai-job-apply-development-resume-durable-r1/*"
    ])
    error_message = "Stack authority must retain exactly the three original stack identities."
  }
  assert {
    condition = toset(one([for s in local.github_deploy_policy.Statement : s.Resource if s.Sid == "ReadApprovedPolicies"])) == toset([
      "arn:aws:iam::111122223333:policy/ai-job-apply-development-workload-boundary",
      "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
      "arn:aws:iam::111122223333:policy/ai-job-apply-development-prep-runtime-r1-boundary",
      "arn:aws:iam::111122223333:policy/ai-job-apply-development-prep-durable-r1-boundary",
      "arn:aws:iam::111122223333:policy/ai-job-apply-development-material-launch-r1-boundary",
      "arn:aws:iam::111122223333:policy/ai-job-apply-development-resume-control-r1-boundary",
      "arn:aws:iam::111122223333:policy/ai-job-apply-development-resume-observer-r1-boundary",
      "arn:aws:iam::111122223333:policy/ai-job-apply-development-resume-durable-r1-boundary"
    ])
    error_message = "Read authority must retain exactly the approved original boundaries."
  }
  assert {
    condition = length(setintersection(toset(one([for s in local.github_deploy_policy.Statement : s.Condition.StringEquals["iam:PermissionsBoundary"] if s.Sid == "CreateBoundedWorkloadRoles"])), toset(local.native_resume_boundary_arns))) == 0 && one([for s in local.github_deploy_policy.Statement : s if s.Sid == "CreateOriginalResumeRoles1"]) == {
      Sid       = "CreateOriginalResumeRoles1", Effect = "Allow", Action = ["iam:CreateRole"],
      Resource  = [for kind in ["control", "observer", "durable"] : "arn:aws:iam::111122223333:role/ai-job-apply-development-resume-${kind}-r1"],
      Condition = { StringEquals = { "iam:PermissionsBoundary" = [for kind in ["control", "observer", "durable"] : "arn:aws:iam::111122223333:policy/ai-job-apply-development-resume-${kind}-r1-boundary"] } }
    }
    error_message = "Compaction must not broaden which roles can be created with resume boundaries."
  }
}
