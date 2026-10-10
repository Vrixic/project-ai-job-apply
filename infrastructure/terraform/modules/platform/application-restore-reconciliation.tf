variable "application_restore_reconciliation" {
  description = "Temporary development-only read diagnostic registration; execution requires separate exact dual-restore and runtime admission."
  type = object({
    run_id     = string
    source_sha = string
    image      = string
    issued_at  = string
    expires_at = string
  })
  default = null
  validation {
    condition = var.application_restore_reconciliation == null ? true : (
      var.environment == "development" && var.persistent_data_plane_enabled &&
      var.development_database_mode == "dormant" && var.legacy_receipt_key_provisioned &&
      !var.private_service_endpoints_enabled && !var.legacy_receipt_replay_enabled && var.legacy_receipt_transition == null &&
      can(regex("^[a-f0-9]{32}$", var.application_restore_reconciliation.run_id)) &&
      can(regex("^[a-f0-9]{40}$", var.application_restore_reconciliation.source_sha)) &&
      can(regex("^${data.aws_caller_identity.current.account_id}[.]dkr[.]ecr[.]us-east-2[.]amazonaws[.]com/ai-job-apply/migration@sha256:[a-f0-9]{64}$", var.application_restore_reconciliation.image)) &&
      data.aws_region.current.region == "us-east-2" &&
      alltrue([for instant in [var.application_restore_reconciliation.issued_at, var.application_restore_reconciliation.expires_at] : can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.]000Z$", instant))]) &&
      try(timecmp(var.application_restore_reconciliation.expires_at, var.application_restore_reconciliation.issued_at) > 0 &&
      timecmp(var.application_restore_reconciliation.expires_at, timeadd(var.application_restore_reconciliation.issued_at, "30m")) <= 0, false)
    )
    error_message = "Reconciliation requires dormant development, retained receipt key, no paid endpoints or replay/transition authority, an exact migration-repository image and a maximum thirty-minute whole-second UTC window."
  }
}

locals {
  application_restore_reconciliation_configured = var.application_restore_reconciliation != null
  application_restore_reconciliation_tags = !local.application_restore_reconciliation_configured ? {} : {
    DiagnosticRunId    = var.application_restore_reconciliation.run_id
    SourceSha          = var.application_restore_reconciliation.source_sha
    AuthorityIssuedAt  = var.application_restore_reconciliation.issued_at
    AuthorityExpiresAt = var.application_restore_reconciliation.expires_at
  }
}

resource "aws_iam_role" "application_restore_reconciliation" {
  count                = local.application_restore_reconciliation_configured ? 1 : 0
  name                 = "${var.name}-${var.environment}-restore-reconciliation"
  assume_role_policy   = data.aws_iam_policy_document.task_assume.json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
  tags                 = local.application_restore_reconciliation_tags
}

resource "aws_iam_role_policy" "application_restore_reconciliation" {
  count = local.application_restore_reconciliation_configured ? 1 : 0
  name  = "restore-reconciliation-decrypt-only"
  role  = aws_iam_role.application_restore_reconciliation[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid = "OriginalReceiptProof", Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.legacy_receipt_encryption[0].arn,
    Condition = {
      StringEquals                = { "kms:EncryptionContext:purpose" = "restricted-legacy-application-receipt.v1" },
      "ForAllValues:StringEquals" = { "kms:EncryptionContextKeys" = ["purpose", "owner_user_id", "application_id", "protection_id", "operation", "metadata_sha256"] },
      DateGreaterThanEquals       = { "aws:CurrentTime" = var.application_restore_reconciliation.issued_at },
      DateLessThan                = { "aws:CurrentTime" = var.application_restore_reconciliation.expires_at }
    }
  }] })
}

resource "aws_ecs_task_definition" "application_restore_reconciliation" {
  count                    = local.application_restore_reconciliation_configured ? 1 : 0
  family                   = "${var.name}-${var.environment}-restore-reconciliation"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.application_restore_reconciliation[0].arn
  enable_fault_injection   = false
  tags                     = local.application_restore_reconciliation_tags
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name    = "restore-reconciliation", image = var.application_restore_reconciliation.image, essential = true,
    command = ["runner/dist/src/application-restore-reconciliation-cli.js"], readonlyRootFilesystem = true,
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "RESTORE_APPLICATIONS_RECONCILIATION_ENABLED", value = "false" }
    ],
    secrets          = [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }],
    logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.application.name, awslogs-region = data.aws_region.current.region, awslogs-stream-prefix = "restore-reconciliation" } }
  }])
  lifecycle {
    create_before_destroy = true
    precondition {
      condition     = startswith(var.application_restore_reconciliation.image, "${aws_ecr_repository.migration.repository_url}@sha256:")
      error_message = "Reconciliation must use the exact retained migration repository."
    }
  }
}

output "application_restore_reconciliation_task_definition_arn" {
  value = local.application_restore_reconciliation_configured ? aws_ecs_task_definition.application_restore_reconciliation[0].arn : null
}
