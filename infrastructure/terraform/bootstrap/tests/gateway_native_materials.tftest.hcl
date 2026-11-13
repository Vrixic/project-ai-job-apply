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
    condition     = !anytrue([for s in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : contains(s.Action, "kms:GenerateMac")])
    error_message = "Default boundary must not grant packet MAC access."
  }
}
run "exact_gateway_fingerprint" {
  command = plan
  variables { gateway_packet_fingerprint_key_arn = "arn:aws:kms:us-east-2:111122223333:key/32345678-1234-4234-8234-123456789012" }
  assert {
    condition     = length(aws_iam_policy.workload_boundary.policy) <= 6144 && length([for s in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : s if contains(s.Action, "kms:GenerateMac") && s.Resource == var.gateway_packet_fingerprint_key_arn && s.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-staging-gateway-lambda" && s.Condition.StringEquals["kms:MacAlgorithm"] == "HMAC_SHA_256"]) == 1
    error_message = "HMAC authority must fit the boundary and belong only to the exact Gateway/key/algorithm."
  }
}
run "foreign_key_refused" {
  command = plan
  variables { gateway_packet_fingerprint_key_arn = "arn:aws:kms:us-east-2:999900001111:key/32345678-1234-4234-8234-123456789012" }
  expect_failures = [var.gateway_packet_fingerprint_key_arn]
}

run "disposal_gateway_only" {
  command = plan
  variables { gateway_native_disposal_clusters = ["arn:aws:ecs:us-east-2:111122223333:cluster/native-materials"] }
  assert {
    condition     = length(aws_iam_policy.workload_boundary.policy) <= 6144 && length([for s in jsondecode(aws_iam_policy.workload_boundary.policy).Statement : s if try(s.Sid, "") == "NativeTaskStop0" && s.Resource == "arn:aws:ecs:us-east-2:111122223333:task/native-materials/*" && s.Condition.ArnEquals["aws:PrincipalArn"] == "arn:aws:iam::111122223333:role/ai-job-apply-staging-gateway-lambda" && s.Condition.ArnEquals["ecs:cluster"] == "arn:aws:ecs:us-east-2:111122223333:cluster/native-materials" && toset(s.Action) == toset(["ecs:DescribeTasks", "ecs:StopTask"])]) == 1
    error_message = "Disposal authority must fit the boundary and belong only to the exact Gateway and cluster (no cleanup worker without a retained cleanup cluster)."
  }
}
run "disposal_foreign_cluster_refused" {
  command = plan
  variables { gateway_native_disposal_clusters = ["arn:aws:ecs:us-east-2:999900001111:cluster/native-materials"] }
  expect_failures = [var.gateway_native_disposal_clusters]
}
