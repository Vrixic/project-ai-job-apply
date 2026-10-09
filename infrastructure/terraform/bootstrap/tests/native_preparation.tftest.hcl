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


run "default_unchanged" {
  command = plan
  assert {
    condition     = length(aws_iam_policy.native_preparation_boundary) == 0 && one([for s in local.github_deploy_policy.Statement : s.Condition.StringEquals["iam:PermissionsBoundary"] if s.Sid == "CreateBoundedWorkloadRoles"]) == local.workload_boundary_arn
    error_message = "Empty preparation configuration must preserve original deployment authority and shape."
  }
}
run "original_release" {
  command = plan
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == [local.preparation_actors["r1/activity"].principal] if contains(["PacketEncryption", "PacketFingerprint"], s.Sid)]) && one([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : s if s.Sid == "OriginalNudge"]).Condition.ArnEquals["aws:PrincipalArn"] == [local.preparation_actors["r1/reconcile"].principal]
    error_message = "Packet cryptography belongs only to activity; queue nudges belong only to reconciliation."
  }

  variables { native_preparation_releases = { r1 = { "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-native-launch:9", "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation-dlq", "queue_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } } }
  assert {
    condition     = length(aws_iam_policy.native_preparation_boundary) == 1 && alltrue([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : alltrue([for arn in s.Condition.ArnEquals["aws:PrincipalArn"] : contains(local.preparation_role_sets.r1.all, arn)])])
    error_message = "Every grant must name only original role principals."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : !contains(s.Action, "ecs:RunTask") && !contains(s.Action, "iam:PassRole") && !contains(s.Action, "s3:GetObject") && (!contains(s.Action, "lambda:InvokeFunction") || length(setintersection(toset(s.Condition.ArnEquals["aws:PrincipalArn"]), toset(local.preparation_role_sets.r1.recovery))) == 0)])
    error_message = "Recovery cannot invoke work and no actor can launch tasks/read objects."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : s if s.Sid == "OriginalLauncher"]).Condition.ArnEquals["aws:PrincipalArn"] == [local.preparation_actors["r1/activity"].principal] && !contains(one([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : s if s.Sid == "OwningDatabase"]).Condition.ArnEquals["aws:PrincipalArn"], local.preparation_actors["r1/durable"].principal)
    error_message = "Only activity invokes launcher; durable must have no SQL secret access."
  }
  assert {
    condition     = length(jsonencode(local.github_deploy_policy)) <= 6144 && length(aws_iam_policy.native_preparation_boundary["r1"].policy) <= 6144
    error_message = "Managed policies must fit IAM limits."
  }
}
run "foreign_launcher_refused" {
  command = plan
  variables { native_preparation_releases = { r1 = { "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "launcher_function_arn" : "arn:aws:lambda:us-east-2:999900001111:function:ai-job-apply-staging-native-launch:9", "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation-dlq", "queue_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } } }
  expect_failures = [var.native_preparation_releases]
}
run "resume_and_cover_letter_coexist" {
  command = plan
  variables {
    native_preparation_releases    = { r1 = { "route" : { "hosted_zone_id" : "ZSYNTHETIC", "base_host" : "materials.example.com" }, "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-native-launch:9", "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation-dlq", "queue_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } }
    native_resume_control_releases = { "7" = { "observer_dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-resume-dlq", "cluster_name" : "native-resume", "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "route" : { "hosted_zone_id" : "ZSYNTHETIC", "base_host" : "resume.example.com" } } }
  }
  assert {
    condition     = length(jsonencode(local.github_deploy_policy)) <= 6144
    error_message = "Combined preparation and resume deployment ceiling must fit IAM."
  }
}

run "original_routing_boundary" {
  command = plan
  variables { native_preparation_releases = { r1 = { "route" : { "hosted_zone_id" : "ZSYNTHETIC", "base_host" : "materials.example.com" }, "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-native-launch:9", "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation-dlq", "queue_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012" } } }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_policy.native_preparation_durable_boundary["r1"].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == [local.preparation_actors["r1/durable"].principal] if contains(["OriginalRouteControl", "OriginalRecords", "InspectOriginalZone", "ObserveOriginalChange"], s.Sid)])
    error_message = "Only original durable actor can control routing or mutate DNS."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_policy.native_preparation_durable_boundary["r1"].policy).Statement : s.Resource if s.Sid == "OriginalRecords"]) == "arn:aws:route53:::hostedzone/ZSYNTHETIC" && one([for s in jsondecode(aws_iam_policy.native_preparation_durable_boundary["r1"].policy).Statement : s.Condition["ForAllValues:StringLike"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"] if s.Sid == "OriginalRecords"])[0] == "????????-????-7???-????-????????????.materials.example.com"
    error_message = "Bootstrap must preserve the exact zone and original allocation hostname ceiling."
  }
  assert {
    condition     = length(aws_iam_policy.native_preparation_durable_boundary["r1"].policy) <= 6144
    error_message = "Routing ceiling must fit the managed-policy limit."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_policy.native_preparation_durable_boundary["r1"].policy).Statement : s.Condition.ArnEquals["aws:PrincipalArn"] == [local.preparation_actors["r1/durable"].principal] && length(setintersection(toset(s.Action), toset(["secretsmanager:GetSecretValue", "kms:GenerateMac", "kms:GenerateDataKey", "ecs:RunTask", "s3:GetObject", "iam:PassRole"]))) == 0]) && !anytrue([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : anytrue([for action in s.Action : startswith(action, "route53:")])])
    error_message = "Routed durable has no owner/task capabilities; shared ceiling has no DNS capabilities."
  }
  assert {
    condition     = contains(local.additional_runtime_boundary_arns, "arn:aws:iam::111122223333:policy/ai-job-apply-staging-prep-durable-r1-boundary")
    error_message = "Deployment may attach only the reviewed original routing ceiling."
  }
}

run "separate_queue_key_preserved" {
  command = plan
  variables { native_preparation_releases = { r1 = { "database_secret_arn" : "arn:aws:secretsmanager:us-east-2:111122223333:secret:ai-job-apply/staging/database-Abc123", "platform_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/12345678-1234-4234-8234-123456789012", "packet_encryption_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/22345678-1234-4234-8234-123456789012", "packet_fingerprint_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012", "launcher_function_arn" : "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-native-launch:9", "queue_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation", "dead_letter_arn" : "arn:aws:sqs:us-east-2:111122223333:ai-job-apply-staging-preparation-dlq", "queue_kms_key_arn" : "arn:aws:kms:us-east-2:111122223333:key/42345678-1234-4234-8234-123456789012" } } }
  assert {
    condition = one([for s in jsondecode(aws_iam_policy.native_preparation_boundary["r1"].policy).Statement : s if s.Sid == "ReadQueue"]) == {
      Sid       = "ReadQueue", Effect = "Allow", Action = ["kms:Decrypt"],
      Resource  = "arn:aws:kms:us-east-2:111122223333:key/42345678-1234-4234-8234-123456789012",
      Condition = { ArnEquals = { "aws:PrincipalArn" = ["arn:aws:iam::111122223333:role/ai-job-apply-staging-prep-starter-r1"] } }
    }
    error_message = "A separate queue key must retain the original starter-only decrypt grant."
  }
}
