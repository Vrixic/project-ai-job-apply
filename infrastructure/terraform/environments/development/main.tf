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
  source                         = "../../modules/platform"
  name                           = "ai-job-apply"
  environment                    = "development"
  vpc_cidr                       = "10.20.0.0/16"
  gateway_image                  = var.gateway_image
  worker_image                   = var.worker_image
  migration_image                = var.migration_image
  gateway_desired_count          = var.gateway_desired_count
  gateway_cpu                    = var.gateway_cpu
  gateway_memory                 = var.gateway_memory
  worker_desired_count           = var.worker_desired_count
  worker_cpu                     = var.worker_cpu
  worker_memory                  = var.worker_memory
  enable_tracing                 = var.enable_tracing
  otel_collector_image           = var.otel_collector_image
  trace_sample_ratio             = var.trace_sample_ratio
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
