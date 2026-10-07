variable "native_material_control_releases" {
  description = "Retained original cover-letter launcher ceilings; empty leaves deployment authority unchanged."
  type = map(object({
    task_revision        = string
    cluster_name         = string
    database_secret_arn  = string
    platform_kms_key_arn = string
  }))
  default  = {}
  nullable = false
  validation {
    condition = length(var.native_material_control_releases) <= 4 && (length(var.native_material_control_releases) == 0 || var.aws_region == "us-east-2") && alltrue([for id, r in var.native_material_control_releases :
      can(regex("^[a-z0-9]{1,12}$", id)) && can(regex("^[1-9][0-9]{0,8}$", r.task_revision)) &&
      can(regex("^ai-job-apply-${var.environment}[A-Za-z0-9_-]*$", r.cluster_name)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${data.aws_caller_identity.current.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", r.database_secret_arn)) &&
      can(regex("^arn:aws:kms:us-east-2:${data.aws_caller_identity.current.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", r.platform_kms_key_arn))
    ])
    error_message = "Use retained original release IDs and exact same-account/environment task, cluster, secret and key."
  }
}
locals {
  native_material_controls = { for id, r in var.native_material_control_releases : id => {
    principal = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-material-launch-${id}"
    boundary  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/ai-job-apply-${var.environment}-material-launch-${id}-boundary"
    task      = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task-definition/ai-job-apply-${var.environment}-native-material:${r.task_revision}"
    cluster   = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/${r.cluster_name}"
    roles     = [for kind in ["task", "execution"] : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-native-material-r${r.task_revision}-${kind}"]
  } }
  native_material_boundary_arns    = [for r in local.native_material_controls : r.boundary]
  additional_runtime_boundary_arns = concat(local.preparation_boundary_arns, local.native_material_boundary_arns)
}
resource "aws_iam_policy" "native_material_control_boundary" {
  for_each    = var.native_material_control_releases
  name        = "ai-job-apply-${var.environment}-material-launch-${each.key}-boundary"
  description = "Original private cover-letter control ceiling; no content or retirement capability."
  policy = jsonencode({ Version = "2012-10-17", Statement = [for statement in [
    { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${data.aws_caller_identity.current.account_id}:log-group:/ai-job-apply/${var.environment}/application:*" },
    { Sid = "Vpc", Effect = "Allow", Action = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    { Sid = "DatabaseSecret", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = each.value.database_secret_arn },
    { Sid = "ConfigurationKey", Effect = "Allow", Action = ["kms:Decrypt"], Resource = each.value.platform_kms_key_arn },
    { Sid = "TaskMetadata", Effect = "Allow", Action = ["ecs:DescribeTaskDefinition"], Resource = "*" },
    { Sid = "OriginalLaunch", Effect = "Allow", Action = ["ecs:RunTask"], Resource = local.native_material_controls[each.key].task,
    Condition = { ArnEquals = { "ecs:cluster" = local.native_material_controls[each.key].cluster }, Bool = { "ecs:enable-execute-command" = "false" } } },
    { Sid = "OriginalRecovery", Effect = "Allow", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task/${each.value.cluster_name}/*",
    Condition = { ArnEquals = { "ecs:cluster" = local.native_material_controls[each.key].cluster } } },
    { Sid = "OriginalRoles", Effect = "Allow", Action = ["iam:PassRole"], Resource = local.native_material_controls[each.key].roles,
    Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
    ] : merge(statement, { Condition = merge(try(statement.Condition, {}), {
      ArnEquals = merge(try(statement.Condition.ArnEquals, {}), { "aws:PrincipalArn" = local.native_material_controls[each.key].principal })
  }) })] })
  lifecycle {
    precondition {
      condition     = length(jsonencode(local.github_deploy_policy)) <= 6144
      error_message = "Combined deployment policy exceeds IAM's managed-policy size limit; retain original releases and split reviewed policy composition before adding more."
    }
  }
}
output "native_material_control_boundary_arns" {
  value = { for id, policy in aws_iam_policy.native_material_control_boundary : id => policy.arn }
}
