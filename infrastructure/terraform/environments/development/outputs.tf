output "vpc_id" {
  value = module.platform.vpc_id
}

output "artifact_bucket" {
  value = module.platform.artifact_bucket
}

output "candidate_document_bucket" {
  value = module.platform.candidate_document_bucket
}

output "candidate_document_malware_protection_plan_id" {
  value = module.platform.candidate_document_malware_protection_plan_id
}

output "migration_repository_url" {
  value = module.platform.migration_repository_url
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

output "gateway_lambda_alias_arn" {
  value = module.platform.gateway_lambda_alias_arn
}

output "public_job_lambda_alias_arn" {
  value = module.platform.public_job_lambda_alias_arn
}

output "public_job_lambda_function_name" {
  value = module.platform.public_job_lambda_function_name
}

output "public_job_projection_lambda_alias_arn" {
  value = module.platform.public_job_projection_lambda_alias_arn
}

output "public_job_projection_lambda_function_name" {
  value = module.platform.public_job_projection_lambda_function_name
}

output "public_job_route_id" {
  value = module.platform.public_job_route_id
}

output "public_job_sitemap_route_id" {
  value = module.platform.public_job_sitemap_route_id
}

output "gateway_lambda_function_name" {
  value = module.platform.gateway_lambda_function_name
}

output "gateway_lambda_authorizer_id" {
  value = module.platform.gateway_lambda_authorizer_id
}

output "outbox_starter_alias_arn" {
  value = module.platform.outbox_starter_alias_arn
}

output "outbox_reconciler_alias_arn" {
  value = module.platform.outbox_reconciler_alias_arn
}

output "outbox_starter_event_source_mapping_uuid" {
  value = module.platform.outbox_starter_event_source_mapping_uuid
}

output "outbox_reconciler_rule_arn" {
  value = module.platform.outbox_reconciler_rule_arn
}

output "profile_readiness_durable_version_arn" {
  value = module.platform.profile_readiness_durable_version_arn
}

output "profile_readiness_durable_alias_arn" {
  value = module.platform.profile_readiness_durable_alias_arn
}

output "profile_readiness_activity_alias_arn" {
  value = module.platform.profile_readiness_activity_alias_arn
}

output "candidate_data_export_bucket" {
  value = module.platform.candidate_data_export_bucket
}

output "candidate_deletion_recovery_bucket" {
  value = module.platform.candidate_deletion_recovery_bucket
}

output "candidate_rights_auth0_secret_arn" {
  value = module.platform.candidate_rights_auth0_secret_arn
}

output "profile_readiness_terminal_alias_arn" {
  value = module.platform.profile_readiness_terminal_alias_arn
}

output "profile_readiness_terminal_rule_arn" {
  value = module.platform.profile_readiness_terminal_rule_arn
}

output "document_processor_alias_arn" {
  value = module.platform.document_processor_alias_arn
}

output "document_parser_version_arn" {
  value = module.platform.document_parser_version_arn
}

output "document_scan_event_source_mapping_uuid" {
  value = module.platform.document_scan_event_source_mapping_uuid
}

output "document_scan_event_rule_arn" {
  value = module.platform.document_scan_event_rule_arn
}

output "d2_community_scheduled_alias_arn" {
  value = module.platform.d2_community_scheduled_alias_arn
}

output "d2_trust_signal_alias_arn" {
  value = module.platform.d2_trust_signal_alias_arn
}

output "d2_trust_signal_queue_arn" {
  value = module.platform.d2_trust_signal_queue_arn
}

output "d2_community_schedule_rule_arn" {
  value = module.platform.d2_community_schedule_rule_arn
}

output "d2_trust_signal_mapping_uuid" {
  value = module.platform.d2_trust_signal_mapping_uuid
}

output "d2_community_route_ids" {
  value = module.platform.d2_community_route_ids
}
