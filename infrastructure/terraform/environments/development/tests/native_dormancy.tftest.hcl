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
      arn = "arn:aws:iam::111122223333:policy/ai-job-apply-staging-workload-boundary"
    }
  }

  mock_data "aws_prefix_list" {
    defaults = { id = "pl-s3gateway" }
  }

  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }

  mock_resource "aws_cloudformation_stack" {
    defaults = {
      outputs = {
        DurableAliasArn   = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:staging"
        DurableVersionArn = "arn:aws:lambda:us-east-2:111122223333:function:ai-job-apply-staging-profile-readiness-durable:1"
      }
    }
  }

  mock_resource "aws_lambda_function" {
    defaults = {
      version       = "1"
      qualified_arn = "arn:aws:lambda:us-east-2:111122223333:function:mock:1"
    }
  }

  mock_resource "aws_lambda_alias" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-2:111122223333:function:mock:staging"
      invoke_arn = "arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:111122223333:function:mock:staging/invocations"
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


mock_provider "aws" { alias = "billing" }


override_module {
  target  = module.platform
  outputs = { account_id = "111122223333" }
}
override_module { target = module.native_resume_source_access["r1"] }
override_module { target = module.native_preparation["r1"] }
override_module { target = module.native_material_control["r1"] }
override_module { target = module.native_resume_preparation["r1"] }

run "reject_native_resume_source_access_releases_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_source_access_releases = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "normalized_bucket" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_preparation_releases_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_preparation_releases_launch_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "launch_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_preparation_releases_intake_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "intake_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_preparation_releases_recovery_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "recovery_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_preparation_releases_drain_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "drain_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_preparation_releases_route_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "route_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_preparation_releases_route_creation_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "route_creation_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_material_control_releases_owner_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_material_control_releases     = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [], "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "image_repository" : "synthetic", "image_sha256" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "task_subnet_ids" : [], "task_security_group_ids" : [] }, "owner_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_material_control_releases_control_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_material_control_releases     = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [], "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "image_repository" : "synthetic", "image_sha256" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "task_subnet_ids" : [], "task_security_group_ids" : [] }, "control_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_material_control_releases_recovery_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_material_control_releases     = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [], "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "image_repository" : "synthetic", "image_sha256" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "task_subnet_ids" : [], "task_security_group_ids" : [] }, "recovery_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_material_control_releases_new_launch_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_material_control_releases     = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [], "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "image_repository" : "synthetic", "image_sha256" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "task_subnet_ids" : [], "task_security_group_ids" : [] }, "new_launch_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_material_control_releases_route_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_material_control_releases     = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [], "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "image_repository" : "synthetic", "image_sha256" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "task_subnet_ids" : [], "task_security_group_ids" : [] }, "route_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_new_launch_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "new_launch_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_observation_events_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "observation_events_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_observation_schedule_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "observation_schedule_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_schedule_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "schedule_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_route_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "route_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_route_creation_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "route_creation_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_terminal_events_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "terminal_events_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_execution_inspection_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "execution_inspection_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_native_resume_preparation_releases_execution_reconciliation_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    document_processing_deployment_stage = "parser-dark"
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] }, "execution_reconciliation_enabled" : true } }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_gateway_owner_cleanup_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode = "dormant"
    gateway_native_materials  = { owner_cleanup_enabled = true }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_gateway_disposal_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode = "dormant"
    gateway_native_materials  = { disposal_enabled = true }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_gateway_resume_preparation_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode = "dormant"
    gateway_native_materials  = { resume_preparation_enabled = true }
  }
  expect_failures = [var.development_database_mode]
}

run "reject_gateway_cover_letter_preparation_enabled_while_dormant" {
  command = plan
  variables {
    development_database_mode = "dormant"
    gateway_native_materials  = { cover_letter_preparation_enabled = true }
  }
  expect_failures = [var.development_database_mode]
}

run "disabled_original_releases_can_remain_dormant" {
  command = plan
  variables {
    development_database_mode            = "dormant"
    native_resume_source_access_releases = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "normalized_bucket" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] } } }
    native_preparation_releases          = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "packet_encryption_key_arn" : "synthetic", "packet_fingerprint_key_arn" : "synthetic", "launcher_function_arn" : "synthetic:1", "queue_arn" : "synthetic:q", "queue_url" : "synthetic", "queue_kms_key_arn" : "synthetic", "dead_letter_arn" : "synthetic:d", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] } } }
    native_material_control_releases     = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "release_id" : "r1", "artifact_bucket" : "synthetic", "artifacts" : {}, "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [], "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "image_repository" : "synthetic", "image_sha256" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "task_subnet_ids" : [], "task_security_group_ids" : [] } } }
    native_resume_preparation_releases   = { r1 = { "release" : { "source_sha" : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "observer_dead_letter_arn" : "synthetic:q", "artifact_bucket" : "synthetic", "artifacts" : {}, "cluster_arn" : "synthetic", "task_definition_arn" : "synthetic:7", "database_secret_arn" : "synthetic", "platform_kms_key_arn" : "synthetic", "image" : "synthetic", "task_subnet_ids" : [], "task_assign_public_ip" : "DISABLED", "task_security_group_ids" : [], "extension_layer_arn" : "synthetic", "subnet_ids" : [], "security_group_ids" : [] } } }
  }
}

run "retained_database_allows_native_intake" {
  command = plan
  variables {
    development_database_mode = "retained"
    gateway_native_materials  = { resume_preparation_enabled = true }
  }
}
run "restore_rejects_native_intake" {
  command = plan
  variables {
    development_database_mode = "restore"
    gateway_native_materials  = { resume_preparation_enabled = true }
  }
  expect_failures = [var.development_database_mode]
}
run "snapshot_preparation_rejects_native_intake" {
  command = plan
  variables {
    development_database_mode = "snapshot-prepared"
    gateway_native_materials  = { resume_preparation_enabled = true }
  }
  expect_failures = [var.development_database_mode]
}

run "endpoint_removal_rejects_native_intake_with_retained_database" {
  command = plan
  variables {
    development_database_mode         = "retained"
    private_service_endpoints_enabled = false
    gateway_native_materials          = { resume_preparation_enabled = true }
  }
  expect_failures = [var.development_database_mode]
}
