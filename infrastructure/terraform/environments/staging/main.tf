terraform {
  required_version = "~> 1.9"
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
      Environment = "staging"
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
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

module "platform" {
  source                         = "../../modules/platform"
  name                           = "ai-job-apply"
  environment                    = "staging"
  vpc_cidr                       = "10.30.0.0/16"
  gateway_image                  = var.gateway_image
  worker_image                   = var.worker_image
  migration_image                = var.migration_image
  gateway_desired_count          = var.gateway_desired_count
  gateway_cpu                    = var.gateway_cpu
  gateway_memory                 = var.gateway_memory
  worker_desired_count           = var.worker_desired_count
  run_continuous_ecs_runtime     = var.run_continuous_ecs_runtime
  worker_cpu                     = var.worker_cpu
  worker_memory                  = var.worker_memory
  high_availability              = var.high_availability
  private_application_networking = var.private_application_networking
  enable_redis                   = var.enable_redis
  database_instance_class        = var.database_instance_class
  database_engine_version        = var.database_engine_version
  database_performance_insights  = var.database_performance_insights
  enable_container_insights      = var.enable_container_insights
  oidc_issuer                    = var.oidc_issuer
  oidc_audience                  = var.oidc_audience
  temporal_address               = var.temporal_address
  temporal_namespace             = var.temporal_namespace
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
  serverless_runtime_cutover           = var.serverless_runtime_cutover
  deploy_serverless_outbox             = var.deploy_serverless_outbox
  workflow_ingress_artifact_s3_key     = var.workflow_ingress_artifact_s3_key
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
}

module "cost_controls" {
  source = "../../modules/cost-controls"

  providers = {
    aws         = aws
    aws.billing = aws.billing
  }

  name                        = "ai-job-apply"
  environment                 = "staging"
  operational_alert_topic_arn = module.platform.operational_alert_topic_arn
  monthly_budget_amount_usd   = 5
  actual_cost_alerts_usd      = [5]
}
