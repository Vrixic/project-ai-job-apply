variable "native_preparation_releases" {
  description = "Original native preparation releases; retain until drain. Empty grants no new authority."
  type = map(object({
    database_secret_arn        = string
    platform_kms_key_arn       = string
    packet_encryption_key_arn  = string
    packet_fingerprint_key_arn = string
    launcher_function_arn      = string
    queue_arn                  = string
    dead_letter_arn            = string
    queue_kms_key_arn          = string
  }))
  default  = {}
  nullable = false
  validation {
    condition = length(var.native_preparation_releases) <= 4 && (length(var.native_preparation_releases) == 0 || var.aws_region == "us-east-2") && alltrue([for id, r in var.native_preparation_releases :
      can(regex("^[a-z0-9]{1,12}$", id)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${data.aws_caller_identity.current.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", r.database_secret_arn)) &&
      alltrue([for key in [r.platform_kms_key_arn, r.packet_encryption_key_arn, r.packet_fingerprint_key_arn, r.queue_kms_key_arn] : can(regex("^arn:aws:kms:us-east-2:${data.aws_caller_identity.current.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", key))]) &&
      length(distinct([r.platform_kms_key_arn, r.packet_encryption_key_arn, r.packet_fingerprint_key_arn])) == 3 &&
      can(regex("^arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-[A-Za-z0-9_-]+:[1-9][0-9]{0,8}$", r.launcher_function_arn)) &&
      alltrue([for arn in [r.queue_arn, r.dead_letter_arn] : can(regex("^arn:aws:sqs:us-east-2:${data.aws_caller_identity.current.account_id}:ai-job-apply-${var.environment}-[A-Za-z0-9_-]+$", arn))]) && r.queue_arn != r.dead_letter_arn
    ])
    error_message = "Use at most four original us-east-2 releases with isolated keys, numeric launcher and same-account/environment resources."
  }
}
locals {
  preparation_actors = merge({}, [for id, r in var.native_preparation_releases : {
    for kind in ["activity", "durable", "starter", "terminal", "reconcile"] : "${id}/${kind}" => {
      release   = r
      kind      = kind
      principal = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-prep-${kind}-${id}"
      function  = "arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-prep-${kind}-${id}"
      durable   = "arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-prep-durable-${id}"
      activity  = "arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-prep-activity-${id}"
    }
  }]...)
  preparation_boundary_arns = [for id in keys(var.native_preparation_releases) : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/ai-job-apply-${var.environment}-prep-runtime-${id}-boundary"]
  preparation_stack_arns    = [for id in keys(var.native_preparation_releases) : "arn:aws:cloudformation:us-east-2:${data.aws_caller_identity.current.account_id}:stack/ai-job-apply-${var.environment}-prep-durable-${id}/*"]
}
locals {
  preparation_role_sets = { for id, r in var.native_preparation_releases : id => {
    all      = [for k in ["activity", "durable", "starter", "terminal", "reconcile"] : local.preparation_actors["${id}/${k}"].principal]
    private  = [for k in ["activity", "starter", "terminal", "reconcile"] : local.preparation_actors["${id}/${k}"].principal]
    recovery = [for k in ["terminal", "reconcile"] : local.preparation_actors["${id}/${k}"].principal]
  } }
}
resource "aws_iam_policy" "native_preparation_boundary" {
  for_each    = var.native_preparation_releases
  name        = "ai-job-apply-${var.environment}-prep-runtime-${each.key}-boundary"
  description = "Original native preparation ceiling with exact role-specific capabilities."
  policy = jsonencode({ Version = "2012-10-17", Statement = concat(
    [for s in [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${data.aws_caller_identity.current.account_id}:log-group:/ai-job-apply/${var.environment}/application:*" },
      { Sid = "Configuration", Effect = "Allow", Action = ["kms:Decrypt"], Resource = each.value.platform_kms_key_arn }
    ] : merge(s, { Condition = { ArnEquals = { "aws:PrincipalArn" = local.preparation_role_sets[each.key].all } } })],
    [for s in [
      { Sid = "Vpc", Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
      { Sid = "OwningDatabase", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = each.value.database_secret_arn }
    ] : merge(s, { Condition = { ArnEquals = { "aws:PrincipalArn" = local.preparation_role_sets[each.key].private } } })],
    [for s in [
      { Sid = "Checkpoints", Effect = "Allow", Action = ["lambda:CheckpointDurableExecution", "lambda:GetDurableExecutionState"], Resource = "${local.preparation_actors["${each.key}/durable"].function}:*" },
      { Sid = "OriginalActivity", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = "${local.preparation_actors["${each.key}/activity"].function}:*" }
    ] : merge(s, { Condition = { ArnEquals = { "aws:PrincipalArn" = [local.preparation_actors["${each.key}/durable"].principal] } } })],
    [for s in [
      { Sid = "OriginalLauncher", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = each.value.launcher_function_arn },
      { Sid = "PacketEncryption", Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = each.value.packet_encryption_key_arn },
      { Sid = "PacketFingerprint", Effect = "Allow", Action = ["kms:GenerateMac"], Resource = each.value.packet_fingerprint_key_arn }
    ] : merge(s, { Condition = { ArnEquals = { "aws:PrincipalArn" = [local.preparation_actors["${each.key}/activity"].principal] } } })],
    [for s in [
      { Sid = "OriginalWorkflow", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = "${local.preparation_actors["${each.key}/durable"].function}:*" },
      { Sid = "OriginalQueue", Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = each.value.queue_arn },
      { Sid = "ReadQueue", Effect = "Allow", Action = ["kms:Decrypt"], Resource = each.value.queue_kms_key_arn }
    ] : merge(s, { Condition = { ArnEquals = { "aws:PrincipalArn" = [local.preparation_actors["${each.key}/starter"].principal] } } })],
    [for s in [
      { Sid = "OriginalExecutionMetadata", Effect = "Allow", Action = ["lambda:GetDurableExecution"], Resource = "${local.preparation_actors["${each.key}/durable"].function}:*/durable-execution/*" },
      { Sid = "RetainFailure", Effect = "Allow", Action = ["sqs:SendMessage"], Resource = each.value.dead_letter_arn },
      { Sid = "QueueEncryption", Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = each.value.queue_kms_key_arn }
    ] : merge(s, { Condition = { ArnEquals = { "aws:PrincipalArn" = local.preparation_role_sets[each.key].recovery } } })],
    [{ Sid = "OriginalNudge", Effect = "Allow", Action = ["sqs:SendMessage"], Resource = each.value.queue_arn, Condition = { ArnEquals = { "aws:PrincipalArn" = [local.preparation_actors["${each.key}/reconcile"].principal] } } }]
  ) })
  lifecycle {
    precondition {
      condition     = length(jsonencode(local.github_deploy_policy)) <= 6144
      error_message = "Combined deployment ceiling exceeds IAM size; do not remove retained releases to fit. Review composition before adding releases."
    }
    postcondition {
      condition     = length(self.policy) <= 6144
      error_message = "Original preparation boundary exceeds IAM size."
    }
  }
}
output "native_preparation_boundary_arns" {
  value = { for id, policy in aws_iam_policy.native_preparation_boundary : id => policy.arn }
}
