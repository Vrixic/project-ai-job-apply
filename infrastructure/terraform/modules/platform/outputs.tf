output "vpc_id" {
  value = aws_vpc.this.id
}

output "database_endpoint" {
  value     = aws_db_instance.postgres.endpoint
  sensitive = true
}

output "artifact_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "gateway_repository_url" {
  value = aws_ecr_repository.gateway.repository_url
}

output "worker_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "temporal_api_key_secret_arn" {
  value = aws_secretsmanager_secret.temporal_api_key.arn
}

output "gateway_url" {
  value = var.deploy_applications ? aws_apigatewayv2_api.gateway[0].api_endpoint : null
}
