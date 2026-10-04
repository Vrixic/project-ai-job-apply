variables {
  bucket_name = "synthetic-candidate-documents"
  account_id  = "111122223333"
  kms_key_arn = "arn:aws:kms:us-east-2:111122223333:key/11111111-2222-3333-4444-555555555555"
}

run "renders_identity_policy_without_resources" {
  command = plan
  assert {
    condition     = jsondecode(output.policy_json).Version == "2012-10-17"
    error_message = "Use the IAM policy version; this output is not a deployed policy."
  }
  assert {
    condition     = alltrue([for statement in jsondecode(output.policy_json).Statement : !can(statement.Principal)])
    error_message = "This is an identity policy, not a bucket policy or caller trust grant."
  }
  assert {
    condition     = length([for statement in jsondecode(output.policy_json).Statement : statement if statement.Effect == "Allow"]) == 2
    error_message = "Only fixed-slot read and replacement capabilities may be granted."
  }
}

run "refuses_bucket_wildcard" {
  command = plan
  variables { bucket_name = "synthetic-*" }
  expect_failures = [var.bucket_name]
}

run "refuses_bucket_arn_or_prefix" {
  command = plan
  variables { bucket_name = "arn:aws:s3:::synthetic/normalized" }
  expect_failures = [var.bucket_name]
}

run "refuses_malformed_account" {
  command = plan
  variables { account_id = "*" }
  expect_failures = [var.account_id]
}

run "refuses_foreign_key" {
  command = plan
  variables { kms_key_arn = "arn:aws:kms:us-east-2:999988887777:key/11111111-2222-3333-4444-555555555555" }
  expect_failures = [var.kms_key_arn]
}

run "refuses_other_region" {
  command = plan
  variables { kms_key_arn = "arn:aws:kms:us-east-1:111122223333:key/11111111-2222-3333-4444-555555555555" }
  expect_failures = [var.kms_key_arn]
}

run "refuses_key_alias" {
  command = plan
  variables { kms_key_arn = "arn:aws:kms:us-east-2:111122223333:alias/synthetic" }
  expect_failures = [var.kms_key_arn]
}
