terraform {
  required_version = "= 1.16.2"
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.14"
    }
  }
}

provider "aws" {
  region = "us-east-2"
  default_tags {
    tags = {
      Project     = "ai-job-apply"
      Environment = "development"
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  alias  = "billing"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "ai-job-apply"
      Environment = "development"
      ManagedBy   = "terraform"
    }
  }
}

module "platform" {
  native_resume_observation_releases = { for release in values(var.native_resume_preparation_releases) : element(reverse(split(":", release.release.task_definition_arn)), 0) => {
    queue_arn   = release.release.observer_dead_letter_arn
    kms_key_arn = release.release.platform_kms_key_arn
  } }

  source                         = "../../modules/platform"
  name                           = "ai-job-apply"
  environment                    = "development"
  vpc_cidr                       = "10.20.0.0/16"
  migration_image                = var.migration_image
  high_availability              = var.high_availability
  private_application_networking = var.private_application_networking
  enable_redis                   = var.enable_redis
  database_instance_class        = var.database_instance_class
  database_engine_version        = var.database_engine_version
  database_backup_retention_days = var.database_backup_retention_days
  database_performance_insights  = var.database_performance_insights
  enable_container_insights      = var.enable_container_insights
  oidc_issuer                    = var.oidc_issuer
  oidc_audience                  = var.oidc_audience
  deploy_applications            = var.deploy_applications
  deploy_gateway_lambda          = var.deploy_gateway_lambda
  gateway_lambda_artifact_s3_key = var.gateway_lambda_artifact_s3_key
  gateway_lambda_artifact_s3_object_version = (
    var.gateway_lambda_artifact_s3_object_version
  )
  gateway_lambda_artifact_sha256       = var.gateway_lambda_artifact_sha256
  gateway_lambda_artifact_base64sha256 = var.gateway_lambda_artifact_base64sha256
  gateway_lambda_extension_layer_arn   = var.gateway_lambda_extension_layer_arn
  gateway_lambda_reserved_concurrency  = var.gateway_lambda_reserved_concurrency
  deploy_public_job_reader             = var.deploy_public_job_reader
  public_job_database_boundary_version = var.public_job_database_boundary_version
  public_job_cluster_residual_accepted = var.public_job_cluster_residual_accepted
  public_job_route_activation_allowed  = var.public_job_route_activation_allowed
  public_job_lambda_artifact_s3_key    = var.public_job_lambda_artifact_s3_key
  public_job_lambda_artifact_s3_object_version = (
    var.public_job_lambda_artifact_s3_object_version
  )
  public_job_lambda_artifact_sha256       = var.public_job_lambda_artifact_sha256
  public_job_lambda_artifact_base64sha256 = var.public_job_lambda_artifact_base64sha256
  public_job_projection_artifact_s3_key   = var.public_job_projection_artifact_s3_key
  public_job_projection_artifact_s3_object_version = (
    var.public_job_projection_artifact_s3_object_version
  )
  public_job_projection_artifact_sha256       = var.public_job_projection_artifact_sha256
  public_job_projection_artifact_base64sha256 = var.public_job_projection_artifact_base64sha256
  public_job_route_throttling_rate_limit      = var.public_job_route_throttling_rate_limit
  public_job_route_throttling_burst_limit     = var.public_job_route_throttling_burst_limit
  deploy_document_intake                      = var.deploy_document_intake
  candidate_document_cors_allowed_origins = (
    var.candidate_document_cors_allowed_origins
  )
  document_processing_deployment_stage          = var.document_processing_deployment_stage
  document_parser_invocation_qualified_arn      = var.document_parser_invocation_qualified_arn
  document_scan_mapping_enabled                 = var.document_scan_mapping_enabled
  document_scan_event_rule_enabled              = var.document_scan_event_rule_enabled
  document_security_health_rules_enabled        = var.document_security_health_rules_enabled
  document_processor_artifact_s3_key            = var.document_processor_artifact_s3_key
  document_processor_artifact_s3_object_version = var.document_processor_artifact_s3_object_version
  document_processor_artifact_sha256            = var.document_processor_artifact_sha256
  document_processor_artifact_base64sha256      = var.document_processor_artifact_base64sha256
  document_parser_artifact_s3_key               = var.document_parser_artifact_s3_key
  document_parser_artifact_s3_object_version    = var.document_parser_artifact_s3_object_version
  document_parser_artifact_sha256               = var.document_parser_artifact_sha256
  document_parser_artifact_base64sha256         = var.document_parser_artifact_base64sha256
  document_processor_extension_layer_arn        = var.document_processor_extension_layer_arn
  document_parser_version                       = var.document_parser_version
  serverless_runtime_enabled                    = var.serverless_runtime_enabled
  outbox_starts_paused                          = var.outbox_starts_paused
  d2_community_runtime                          = var.d2_community_runtime
  deploy_serverless_outbox                      = var.deploy_serverless_outbox
  workflow_ingress_artifact_s3_key              = var.workflow_ingress_artifact_s3_key
  workflow_ingress_artifact_s3_object_version = (
    var.workflow_ingress_artifact_s3_object_version
  )
  workflow_ingress_artifact_sha256       = var.workflow_ingress_artifact_sha256
  workflow_ingress_artifact_base64sha256 = var.workflow_ingress_artifact_base64sha256
  workflow_ingress_lambda_extension_layer_arn = (
    var.workflow_ingress_lambda_extension_layer_arn
  )
  deploy_profile_readiness_durable                      = var.deploy_profile_readiness_durable
  profile_readiness_durable_artifact_s3_key             = var.profile_readiness_durable_artifact_s3_key
  profile_readiness_durable_artifact_s3_object_version  = var.profile_readiness_durable_artifact_s3_object_version
  profile_readiness_durable_artifact_sha256             = var.profile_readiness_durable_artifact_sha256
  profile_readiness_durable_artifact_base64sha256       = var.profile_readiness_durable_artifact_base64sha256
  profile_readiness_activity_artifact_s3_key            = var.profile_readiness_activity_artifact_s3_key
  profile_readiness_activity_artifact_s3_object_version = var.profile_readiness_activity_artifact_s3_object_version
  profile_readiness_activity_artifact_sha256            = var.profile_readiness_activity_artifact_sha256
  profile_readiness_activity_artifact_base64sha256      = var.profile_readiness_activity_artifact_base64sha256
  profile_readiness_lambda_extension_layer_arn          = var.profile_readiness_lambda_extension_layer_arn
  profile_readiness_execution_timeout_seconds           = var.profile_readiness_execution_timeout_seconds
  profile_readiness_retention_days                      = var.profile_readiness_retention_days
  candidate_rights_enabled                              = var.candidate_rights_enabled
  document_tailoring_invoke_enabled                     = var.document_tailoring_invoke_enabled
  candidate_deletion_restore_role_enabled               = var.candidate_deletion_restore_role_enabled
  candidate_rights_auth0_secret_provisioned             = var.candidate_rights_auth0_secret_provisioned
  candidate_rights_auth0_authorized_owner               = var.candidate_rights_auth0_authorized_owner
  candidate_rights_id_token_audience                    = var.candidate_rights_id_token_audience
  candidate_rights_policy_version                       = var.candidate_rights_policy_version
  candidate_rights_policy_sha256                        = var.candidate_rights_policy_sha256
  candidate_rights_export_lifetime_seconds              = var.candidate_rights_export_lifetime_seconds
  candidate_rights_download_grant_seconds               = var.candidate_rights_download_grant_seconds
  candidate_rights_backup_retention_days                = var.candidate_rights_backup_retention_days
  candidate_rights_recent_auth_max_age_seconds          = var.candidate_rights_recent_auth_max_age_seconds
  candidate_rights_owner_inventory                      = var.candidate_rights_owner_inventory
  candidate_rights_subprocessor_inventory               = var.candidate_rights_subprocessor_inventory
  candidate_rights_export_lifecycle_days                = var.candidate_rights_export_lifecycle_days
  deploy_ingestion_runtime                              = var.deploy_ingestion_runtime
  ingestion_runtime_enabled                             = var.ingestion_runtime_enabled
  ingestion_synthetic_source_enabled                    = var.ingestion_synthetic_source_enabled
  ingestion_provider_activation_allowed                 = var.ingestion_provider_activation_allowed
  ingestion_provider_private_egress                     = var.ingestion_provider_private_egress
  ingestion_provider_sources                            = var.ingestion_provider_sources
  ingestion_durable_artifact_s3_key                     = var.ingestion_durable_artifact_s3_key
  ingestion_durable_artifact_s3_object_version          = var.ingestion_durable_artifact_s3_object_version
  ingestion_durable_artifact_sha256                     = var.ingestion_durable_artifact_sha256
  ingestion_durable_artifact_base64sha256               = var.ingestion_durable_artifact_base64sha256
  ingestion_runtime_artifact_s3_key                     = var.ingestion_runtime_artifact_s3_key
  ingestion_runtime_artifact_s3_object_version          = var.ingestion_runtime_artifact_s3_object_version
  ingestion_runtime_artifact_sha256                     = var.ingestion_runtime_artifact_sha256
  ingestion_runtime_artifact_base64sha256               = var.ingestion_runtime_artifact_base64sha256
  ingestion_lambda_extension_layer_arn                  = var.ingestion_lambda_extension_layer_arn
  ingestion_synthetic_seed                              = var.ingestion_synthetic_seed
  ingestion_execution_timeout_seconds                   = var.ingestion_execution_timeout_seconds
  ingestion_retention_days                              = var.ingestion_retention_days

  restricted_answer_vault_enabled               = var.restricted_answer_vault_enabled
  restricted_answer_export_enabled              = var.restricted_answer_export_enabled
  applications_attempt_recovery_enabled         = var.applications_attempt_recovery_enabled
  applications_attempt_recovery_artifact_s3_key = var.applications_attempt_recovery_artifact_s3_key
  applications_attempt_recovery_artifact_s3_object_version = (
    var.applications_attempt_recovery_artifact_s3_object_version
  )
  applications_attempt_recovery_artifact_sha256       = var.applications_attempt_recovery_artifact_sha256
  applications_attempt_recovery_artifact_base64sha256 = var.applications_attempt_recovery_artifact_base64sha256
}

module "cost_controls" {
  source = "../../modules/cost-controls"

  providers = {
    aws         = aws
    aws.billing = aws.billing
  }

  name                        = "ai-job-apply"
  environment                 = "development"
  operational_alert_topic_arn = module.platform.operational_alert_topic_arn
  monthly_budget_amount_usd   = 5
  actual_cost_alerts_usd      = [5]
}
