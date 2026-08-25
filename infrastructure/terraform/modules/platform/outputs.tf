output "vpc_id" {
  value = aws_vpc.this.id
}

output "database_endpoint" {
  value     = var.persistent_data_plane_enabled ? aws_db_instance.postgres[0].endpoint : null
  sensitive = true
}

output "artifact_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "candidate_document_bucket" {
  value = var.deploy_document_intake ? aws_s3_bucket.candidate_documents[0].bucket : null
}

output "candidate_data_export_bucket" {
  value = var.candidate_rights_enabled ? aws_s3_bucket.candidate_data_exports[0].bucket : null
}

output "candidate_deletion_recovery_bucket" {
  value = var.candidate_rights_enabled ? aws_s3_bucket.candidate_deletion_recovery[0].bucket : null
}

output "candidate_rights_auth0_secret_arn" {
  description = "Populate this managed secret with exact clientId, clientSecret, and revocationMode JSON before activation evidence."
  value       = var.candidate_rights_enabled ? aws_secretsmanager_secret.candidate_rights_auth0[0].arn : null
}

output "candidate_document_malware_protection_plan_id" {
  value = var.deploy_document_intake ? aws_guardduty_malware_protection_plan.candidate_documents[0].id : null
}

output "document_processor_alias_arn" {
  value = local.document_complete_dark_enabled ? aws_lambda_alias.document_processor[0].arn : null
}

output "document_parser_version_arn" {
  value = local.document_parser_dark_enabled ? aws_lambda_function.document_parser[0].qualified_arn : null
}

output "document_scan_event_source_mapping_uuid" {
  value = local.document_complete_dark_enabled ? aws_lambda_event_source_mapping.document_scan_results[0].uuid : null
}

output "document_scan_event_rule_arn" {
  value = local.document_parser_dark_enabled ? aws_cloudwatch_event_rule.document_scan_results[0].arn : null
}

output "migration_repository_url" {
  value = aws_ecr_repository.migration.repository_url
}

output "gateway_url" {
  value = var.deploy_applications ? aws_apigatewayv2_api.gateway[0].api_endpoint : null
}

output "ecs_cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "migration_task_definition_arn" {
  value = var.migration_image != "" && var.persistent_data_plane_enabled ? aws_ecs_task_definition.migration[0].arn : null
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

output "gateway_lambda_alias_arn" {
  value = var.deploy_gateway_lambda ? aws_lambda_alias.gateway[0].arn : null
}

output "gateway_lambda_function_name" {
  value = var.deploy_gateway_lambda ? aws_lambda_function.gateway[0].function_name : null
}

output "public_job_lambda_alias_arn" {
  value = var.deploy_public_job_reader ? aws_lambda_alias.public_job[0].arn : null
}

output "public_job_lambda_function_name" {
  value = var.deploy_public_job_reader ? aws_lambda_function.public_job[0].function_name : null
}

output "public_job_projection_lambda_alias_arn" {
  value = var.deploy_public_job_reader ? aws_lambda_alias.public_job_projection[0].arn : null
}

output "public_job_projection_lambda_function_name" {
  value = var.deploy_public_job_reader ? aws_lambda_function.public_job_projection[0].function_name : null
}

output "public_job_route_id" {
  value = local.public_job_route_enabled ? aws_apigatewayv2_route.public_job[0].id : null
}

output "public_job_sitemap_route_id" {
  value = local.public_job_route_enabled ? aws_apigatewayv2_route.public_job_sitemap[0].id : null
}

output "gateway_lambda_authorizer_id" {
  value = var.deploy_gateway_lambda ? aws_apigatewayv2_authorizer.gateway[0].id : null
}

output "outbox_starter_alias_arn" {
  value = var.deploy_serverless_outbox ? aws_lambda_alias.outbox_starter[0].arn : null
}

output "outbox_reconciler_alias_arn" {
  value = var.deploy_serverless_outbox ? aws_lambda_alias.outbox_reconciler[0].arn : null
}

output "outbox_starter_event_source_mapping_uuid" {
  value = var.deploy_serverless_outbox ? aws_lambda_event_source_mapping.outbox_starter[0].uuid : null
}

output "outbox_reconciler_rule_arn" {
  value = var.deploy_serverless_outbox ? aws_cloudwatch_event_rule.outbox_reconciler[0].arn : null
}

output "profile_readiness_durable_version_arn" {
  value = var.deploy_profile_readiness_durable ? local.profile_readiness_durable_version_arn : null
}

output "profile_readiness_durable_alias_arn" {
  value = var.deploy_profile_readiness_durable ? aws_cloudformation_stack.profile_readiness_durable[0].outputs["DurableAliasArn"] : null
}

output "profile_readiness_activity_alias_arn" {
  value = var.deploy_profile_readiness_durable ? aws_lambda_alias.profile_readiness_activity[0].arn : null
}

output "profile_readiness_terminal_alias_arn" {
  value = var.deploy_profile_readiness_durable ? aws_lambda_alias.profile_readiness_terminal[0].arn : null
}

output "profile_readiness_terminal_rule_arn" {
  value = var.deploy_profile_readiness_durable ? aws_cloudwatch_event_rule.profile_readiness_terminal[0].arn : null
}
