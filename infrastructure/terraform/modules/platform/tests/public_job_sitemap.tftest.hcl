mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-2a", "us-east-2b"] }
  }

  mock_data "aws_region" {
    defaults = { region = "us-east-2", name = "us-east-2" }
  }

  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }

  mock_data "aws_iam_policy" {
    defaults = {
      arn = "arn:aws:iam::111122223333:policy/ai-job-apply-development-workload-boundary"
    }
  }

  mock_data "aws_prefix_list" {
    defaults = { id = "pl-s3gateway" }
  }

  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }

  mock_resource "aws_lambda_function" {
    defaults = {
      version       = "1"
      qualified_arn = "arn:aws:lambda:us-east-2:111122223333:function:mock:1"
    }
  }

  mock_resource "aws_lambda_alias" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-2:111122223333:function:mock:development"
      invoke_arn = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:111122223333:function:mock:development/invocations"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      resource_id = "db-ABCDEFGHIJKLMNOPQRSTUVWX"
      address     = "database.cluster.us-east-2.rds.amazonaws.com"
      port        = 5432
      db_name     = "ai_job_apply"
    }
  }
}

mock_provider "random" {}
mock_provider "time" {}

variables {
  name        = "ai-job-apply"
  environment = "development"
  vpc_cidr    = "10.20.0.0/16"

  oidc_issuer   = "https://example.auth0.com/"
  oidc_audience = "https://api.example.invalid"

  deploy_applications                              = true
  deploy_public_job_reader                         = true
  public_job_database_boundary_version             = "0013_public_job_sitemap"
  public_job_lambda_artifact_s3_key                = "lambda/public-jobs/reader.zip"
  public_job_lambda_artifact_s3_object_version     = "public-reader-version"
  public_job_lambda_artifact_sha256                = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  public_job_lambda_artifact_base64sha256          = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
  public_job_projection_artifact_s3_key            = "lambda/public-jobs/projection.zip"
  public_job_projection_artifact_s3_object_version = "public-projection-version"
  public_job_projection_artifact_sha256            = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  public_job_projection_artifact_base64sha256      = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI="
}

run "sitemap_reader_stays_dark_by_default" {
  command = plan

  assert {
    condition = (
      length(aws_lambda_function.public_job) == 1 &&
      length(aws_lambda_function.public_job_projection) == 1 &&
      length(aws_apigatewayv2_route.public_job) == 0 &&
      length(aws_apigatewayv2_route.public_job_sitemap) == 0 &&
      length(aws_cloudwatch_metric_alarm.public_job_sitemap_route_4xx) == 0 &&
      length(aws_cloudwatch_metric_alarm.public_job_sitemap_route_5xx) == 0
    )
    error_message = "The two isolated readers may deploy dark, but neither anonymous route or route alarm may exist without activation."
  }
}

run "sitemap_reader_rejects_the_obsolete_detail_only_boundary" {
  command = plan

  variables {
    public_job_database_boundary_version = "0006_public_job_reader"
  }

  expect_failures = [var.public_job_database_boundary_version]
}
