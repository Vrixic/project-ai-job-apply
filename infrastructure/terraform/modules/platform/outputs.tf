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

output "ecs_cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "migration_task_definition_arn" {
  value = var.migration_image == "" ? null : aws_ecs_task_definition.migration[0].arn
}

output "migration_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "application_security_group_id" {
  value = aws_security_group.application.id
}

output "operational_alert_topic_arn" {
  value     = aws_sns_topic.operational_alerts.arn
  sensitive = true

  depends_on = [
    aws_kms_key.platform,
    aws_sns_topic_policy.operational_alerts
  ]
}

output "observability_dashboard_name" {
  value = aws_cloudwatch_dashboard.operations.dashboard_name
}

output "alert_delivery_canary_alarm_name" {
  value = aws_cloudwatch_metric_alarm.alert_delivery_canary.alarm_name
}

output "gateway_log_heartbeat_alarm_name" {
  value = var.deploy_applications ? aws_cloudwatch_metric_alarm.gateway_log_heartbeat_missing[0].alarm_name : null
}

output "worker_log_heartbeat_alarm_name" {
  value = var.deploy_applications ? aws_cloudwatch_metric_alarm.worker_log_heartbeat_missing[0].alarm_name : null
}

output "gateway_lambda_alias_arn" {
  value = var.deploy_gateway_lambda ? aws_lambda_alias.gateway[0].arn : null
}

output "gateway_lambda_function_name" {
  value = var.deploy_gateway_lambda ? aws_lambda_function.gateway[0].function_name : null
}

output "gateway_lambda_authorizer_id" {
  value = var.deploy_gateway_lambda ? aws_apigatewayv2_authorizer.gateway[0].id : null
}
