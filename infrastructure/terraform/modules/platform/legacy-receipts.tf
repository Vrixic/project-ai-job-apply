variable "legacy_receipt_key_provisioned" {
  description = "Retain a dedicated key for encrypted historical receipt identity; no caller is enabled by provisioning."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.legacy_receipt_key_provisioned || (var.persistent_data_plane_enabled && data.aws_region.current.region == "us-east-2")
    error_message = "Legacy receipt keys require the retained us-east-2 data plane."
  }
}
variable "legacy_receipt_replay_enabled" {
  description = "Enable Gateway decrypt-only replay after the archive migration and release acceptance."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.legacy_receipt_replay_enabled || (var.legacy_receipt_key_provisioned && var.deploy_gateway_lambda && try(var.gateway_native_materials.packet_protection_enabled, false))
    error_message = "Legacy replay requires its dedicated key and the protected Applications Gateway."
  }
}
variable "legacy_receipt_transition" {
  description = "Explicit short-lived development maintenance binding, accepted only after runtime drain and recovery snapshot verification."
  type = object({
    run_id                      = string
    source_sha                  = string
    snapshot_arn                = string
    snapshot_created_at         = string
    expected_applied_migrations = number
    expected_legacy_receipts    = number
    issued_at                   = string
    expires_at                  = string
  })
  default = null
  validation {
    condition = var.legacy_receipt_transition == null ? true : (
      var.environment == "development" && var.legacy_receipt_key_provisioned && local.database_provisioned && local.migration_task_enabled &&
      var.private_service_endpoints_enabled && !var.serverless_runtime_enabled && !var.ingestion_runtime_enabled &&
      !var.document_scan_mapping_enabled && !var.document_scan_event_rule_enabled && !var.d2_community_runtime.enabled &&
      !var.privileged_audit_retention_enabled && !var.job_retention_enabled && !var.native_cleanup_enabled &&
      can(regex("^[a-f0-9]{32}$", var.legacy_receipt_transition.run_id)) &&
      can(regex("^[a-f0-9]{40}$", var.legacy_receipt_transition.source_sha)) &&
      can(regex("^arn:aws:rds:us-east-2:${data.aws_caller_identity.current.account_id}:snapshot:${var.name}-development-[a-z0-9-]{1,180}$", var.legacy_receipt_transition.snapshot_arn)) &&
      contains([3, 4, 5, 6, 7, 8], var.legacy_receipt_transition.expected_applied_migrations) &&
      var.legacy_receipt_transition.expected_legacy_receipts >= 1 && var.legacy_receipt_transition.expected_legacy_receipts <= 1000 &&
      floor(var.legacy_receipt_transition.expected_legacy_receipts) == var.legacy_receipt_transition.expected_legacy_receipts &&
      alltrue([for instant in [var.legacy_receipt_transition.issued_at, var.legacy_receipt_transition.expires_at, var.legacy_receipt_transition.snapshot_created_at] : can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$", instant))]) &&
      try(timecmp(var.legacy_receipt_transition.expires_at, var.legacy_receipt_transition.issued_at) > 0 &&
        timecmp(var.legacy_receipt_transition.expires_at, timeadd(var.legacy_receipt_transition.issued_at, "30m")) <= 0 &&
        timecmp(var.legacy_receipt_transition.snapshot_created_at, var.legacy_receipt_transition.issued_at) <= 0 &&
      timecmp(var.legacy_receipt_transition.issued_at, timeadd(var.legacy_receipt_transition.snapshot_created_at, "1h")) <= 0, false)
    )
    error_message = "Legacy receipt maintenance requires drained development, an exact fresh snapshot, bounded counts, a reviewed image and a maximum thirty-minute configuration."
  }
}
resource "aws_kms_key" "legacy_receipt_encryption" {
  count                    = var.legacy_receipt_key_provisioned ? 1 : 0
  description              = "${var.name} ${var.environment} encrypted historical application receipt identity"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  key_usage                = "ENCRYPT_DECRYPT"
  deletion_window_in_days  = 30
  enable_key_rotation      = true
  policy = jsonencode({ Version = "2012-10-17", Statement = [local.restricted_packet_key_delegation, {
    Sid       = "RejectOtherPurposes", Effect = "Deny", Principal = "*", Action = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey*"], Resource = "*",
    Condition = { StringNotEquals = { "kms:EncryptionContext:purpose" = "restricted-legacy-application-receipt.v1" } }
  }] })
  lifecycle { prevent_destroy = true }
}
locals {
  legacy_receipt_transition_configured = var.legacy_receipt_transition != null
  legacy_receipt_replay_statements = !var.legacy_receipt_replay_enabled ? [] : [{
    Sid       = "LegacyReceiptReplay", Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.legacy_receipt_encryption[0].arn,
    Condition = { StringEquals = { "kms:EncryptionContext:purpose" = "restricted-legacy-application-receipt.v1" } }
  }]
  legacy_receipt_transition_statements = !local.legacy_receipt_transition_configured ? [] : [{
    Sid       = "LegacyReceiptTransition", Effect = "Allow", Action = ["kms:Encrypt", "kms:Decrypt"], Resource = aws_kms_key.legacy_receipt_encryption[0].arn,
    Condition = { StringEquals = { "kms:EncryptionContext:purpose" = "restricted-legacy-application-receipt.v1" } }
  }]
  legacy_receipt_endpoint_statements = concat(
    [for statement in local.legacy_receipt_replay_statements : merge(statement, { Principal = "*", Condition = merge(statement.Condition, { ArnEquals = { "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-gateway-lambda" } }) })],
    [for statement in local.legacy_receipt_transition_statements : merge(statement, { Principal = "*", Condition = merge(statement.Condition, { ArnEquals = { "aws:PrincipalArn" = aws_iam_role.legacy_receipt_transition[0].arn } }) })]
  )
  legacy_receipt_gateway_environment = !var.legacy_receipt_replay_enabled ? {} : {
    LEGACY_RECEIPT_REPLAY_ENABLED     = "true"
    LEGACY_RECEIPT_ENCRYPTION_KEY_ARN = aws_kms_key.legacy_receipt_encryption[0].arn
  }
  legacy_receipt_transition_configuration = !local.legacy_receipt_transition_configured ? null : {
    schemaVersion             = 1
    runId                     = var.legacy_receipt_transition.run_id
    sourceSha                 = var.legacy_receipt_transition.source_sha
    imageDigest               = element(split("@sha256:", var.migration_image), 1)
    accountId                 = data.aws_caller_identity.current.account_id
    region                    = "us-east-2"
    databaseIdentifier        = "${var.name}-development"
    databaseResourceId        = local.retained_database_resource_id
    databaseHostname          = local.retained_database_address
    databaseName              = local.retained_database_name
    databasePort              = local.retained_database_port
    snapshotArn               = var.legacy_receipt_transition.snapshot_arn
    snapshotCreatedAt         = var.legacy_receipt_transition.snapshot_created_at
    encryptionKeyArn          = aws_kms_key.legacy_receipt_encryption[0].arn
    expectedAppliedMigrations = var.legacy_receipt_transition.expected_applied_migrations
    expectedLegacyReceipts    = var.legacy_receipt_transition.expected_legacy_receipts
    issuedAt                  = var.legacy_receipt_transition.issued_at
    expiresAt                 = var.legacy_receipt_transition.expires_at
  }
}
resource "aws_iam_role_policy" "legacy_receipt_replay" {
  count  = var.legacy_receipt_replay_enabled ? 1 : 0
  name   = "legacy-receipt-replay"
  role   = aws_iam_role.gateway_lambda[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.legacy_receipt_replay_statements })
}
resource "aws_iam_role" "legacy_receipt_transition" {
  count                = local.legacy_receipt_transition_configured ? 1 : 0
  name                 = "${var.name}-${var.environment}-legacy-receipt-transition"
  assume_role_policy   = data.aws_iam_policy_document.task_assume.json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}
resource "aws_iam_role_policy" "legacy_receipt_transition" {
  count  = local.legacy_receipt_transition_configured ? 1 : 0
  name   = "legacy-receipt-transition"
  role   = aws_iam_role.legacy_receipt_transition[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.legacy_receipt_transition_statements })
}
resource "aws_ecs_task_definition" "legacy_receipt_transition" {
  count                    = local.legacy_receipt_transition_configured ? 1 : 0
  family                   = "${var.name}-${var.environment}-legacy-receipt-transition"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.legacy_receipt_transition[0].arn
  enable_fault_injection   = false
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name    = "legacy-receipt-transition", image = var.migration_image, essential = true,
    command = ["applications/dist/src/run-legacy-receipt-transition.js"], readonlyRootFilesystem = true,
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "LEGACY_RECEIPT_TRANSITION_ENABLED", value = "true" },
      { name = "LEGACY_RECEIPT_TRANSITION_CONFIG_JSON", value = jsonencode(local.legacy_receipt_transition_configuration) },
      { name = "LEGACY_RECEIPT_TRANSITION_CONFIG_SHA256", value = sha256(jsonencode(local.legacy_receipt_transition_configuration)) }
    ],
    secrets          = [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }],
    logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.application.name, awslogs-region = data.aws_region.current.region, awslogs-stream-prefix = "legacy-receipt-transition" } }
  }])
  lifecycle {
    create_before_destroy = true
    precondition {
      condition     = startswith(var.migration_image, "${aws_ecr_repository.migration.repository_url}@sha256:")
      error_message = "Legacy transition must use the dedicated immutable migration image."
    }
  }
}
output "legacy_receipt_key_arn" { value = var.legacy_receipt_key_provisioned ? aws_kms_key.legacy_receipt_encryption[0].arn : null }
output "legacy_receipt_transition_task_definition_arn" { value = local.legacy_receipt_transition_configured ? aws_ecs_task_definition.legacy_receipt_transition[0].arn : null }
