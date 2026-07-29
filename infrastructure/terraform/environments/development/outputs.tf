output "vpc_id" {
  value = module.platform.vpc_id
}

output "artifact_bucket" {
  value = module.platform.artifact_bucket
}

output "gateway_repository_url" {
  value = module.platform.gateway_repository_url
}

output "worker_repository_url" {
  value = module.platform.worker_repository_url
}

output "temporal_api_key_secret_arn" {
  value = module.platform.temporal_api_key_secret_arn
}

output "gateway_url" {
  value = module.platform.gateway_url
}
