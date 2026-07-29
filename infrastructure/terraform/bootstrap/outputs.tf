output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "state_kms_key_arn" {
  value = aws_kms_key.state.arn
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "workload_permissions_boundary_arn" {
  value = aws_iam_policy.workload_boundary.arn
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}
