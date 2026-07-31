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

output "ecs_cluster_arn" {
  value = module.platform.ecs_cluster_arn
}

output "migration_task_definition_arn" {
  value = module.platform.migration_task_definition_arn
}

output "migration_subnet_ids" {
  value = module.platform.migration_subnet_ids
}

output "application_security_group_id" {
  value = module.platform.application_security_group_id
}

output "operational_alert_topic_arn" {
  value     = module.platform.operational_alert_topic_arn
  sensitive = true
}

output "observability_dashboard_name" {
  value = module.platform.observability_dashboard_name
}

output "alert_delivery_canary_alarm_name" {
  value = module.platform.alert_delivery_canary_alarm_name
}

output "gateway_log_heartbeat_alarm_name" {
  value = module.platform.gateway_log_heartbeat_alarm_name
}

output "worker_log_heartbeat_alarm_name" {
  value = module.platform.worker_log_heartbeat_alarm_name
}

output "monthly_budget_name" {
  value = module.cost_controls.monthly_budget_name
}

output "cost_export_arn" {
  value     = module.cost_controls.cost_export_arn
  sensitive = true
}

output "cost_export_bucket" {
  value     = module.cost_controls.cost_export_bucket
  sensitive = true
}
