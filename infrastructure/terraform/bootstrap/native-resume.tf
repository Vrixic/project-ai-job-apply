variable "native_resume_control_releases" {
  description = "Explicit original resume releases approved for private control IAM. Empty preserves existing bootstrap behavior. Keys are original task revisions; retain until trusted drain."
  type = map(object({
    observer_dead_letter_arn = string
    cluster_name             = string
    database_secret_arn      = string
    platform_kms_key_arn     = string
    route                    = optional(object({ hosted_zone_id = string, base_host = string }))
  }))
  default  = {}
  nullable = false
  validation {
    condition = length(var.native_resume_control_releases) <= 4 && alltrue([for revision, release in var.native_resume_control_releases :
      (release.route == null ? true : (can(regex("^Z[A-Z0-9]{1,31}$", release.route.hosted_zone_id)) && length(release.route.base_host) <= 200 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$", release.route.base_host)))) &&
      can(regex("^[1-9][0-9]{0,8}$", revision)) &&
      can(regex("^arn:aws:sqs:us-east-2:${data.aws_caller_identity.current.account_id}:ai-job-apply-${var.environment}-[A-Za-z0-9_-]+$", release.observer_dead_letter_arn)) &&
      can(regex("^[A-Za-z0-9_-]{1,255}$", release.cluster_name)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${data.aws_caller_identity.current.account_id}:secret:ai-job-apply/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", release.database_secret_arn)) &&
      can(regex("^arn:aws:kms:us-east-2:${data.aws_caller_identity.current.account_id}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", release.platform_kms_key_arn))
    ]) && (length(var.native_resume_control_releases) == 0 || var.aws_region == "us-east-2")
    error_message = "Use at most four retained original numeric revisions with same-account/environment secret/key and an exact us-east-2 cluster."
  }
}
locals {
  native_resume_controls = { for revision, release in var.native_resume_control_releases : revision => {
    principal = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-resume-control-r${revision}"
    boundary  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/ai-job-apply-${var.environment}-resume-control-r${revision}-boundary"
    cluster   = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/${release.cluster_name}"
    task      = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task-definition/ai-job-apply-${var.environment}-native-resume:${revision}"
    roles     = [for kind in ["task", "execution"] : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-native-resume-r${revision}-${kind}"]
  } }
  # Coalesce only identical unconditional grants. Original role creation conditions stay
  # separate; adding resume ceilings to the general role-creation list would broaden access.
  native_resume_boundary_arns = flatten([for release in local.native_resume_controls : [
    for kind in ["control", "observer", "durable"] : replace(release.boundary, "resume-control-", "resume-${kind}-")
  ]])
  native_deploy_stack_arns = concat(local.preparation_stack_arns, [
    for revision in keys(local.native_resume_controls) : "arn:aws:cloudformation:us-east-2:${data.aws_caller_identity.current.account_id}:stack/ai-job-apply-${var.environment}-resume-durable-r${revision}/*"
  ])
  native_resume_deploy_statements = flatten([for revision, release in local.native_resume_controls : [
    { Sid       = "CreateOriginalResumeRoles${revision}", Effect = "Allow", Action = ["iam:CreateRole"],
      Resource  = [for kind in ["control", "observer", "durable"] : replace(release.principal, "resume-control-", "resume-${kind}-")],
      Condition = { StringEquals = { "iam:PermissionsBoundary" = [for kind in ["control", "observer", "durable"] : replace(release.boundary, "resume-control-", "resume-${kind}-")] } }
    }
  ]])
}
resource "aws_iam_policy" "native_resume_control_boundary" {
  for_each    = var.native_resume_control_releases
  name        = "ai-job-apply-${var.environment}-resume-control-r${each.key}-boundary"
  description = "Original private resume control ceiling; no content or retirement capability."
  policy = jsonencode({ Version = "2012-10-17", Statement = [for statement in [
    { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${data.aws_caller_identity.current.account_id}:log-group:/ai-job-apply/${var.environment}/application:*" },
    { Sid = "Vpc", Effect = "Allow", Action = ["ec2:AssignPrivateIpAddresses", "ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    { Sid = "DatabaseSecret", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = each.value.database_secret_arn },
    { Sid = "ConfigurationKey", Effect = "Allow", Action = ["kms:Decrypt"], Resource = each.value.platform_kms_key_arn },
    { Sid = "TaskMetadata", Effect = "Allow", Action = ["ecs:DescribeTaskDefinition"], Resource = "*" },
    { Sid = "OriginalLaunch", Effect = "Allow", Action = ["ecs:RunTask"], Resource = local.native_resume_controls[each.key].task,
    Condition = { ArnEquals = { "ecs:cluster" = local.native_resume_controls[each.key].cluster }, Bool = { "ecs:enable-execute-command" = "false" } } },
    { Sid = "OriginalRecovery", Effect = "Allow", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task/${each.value.cluster_name}/*",
    Condition = { ArnEquals = { "ecs:cluster" = local.native_resume_controls[each.key].cluster } } },
    { Sid = "OriginalRoles", Effect = "Allow", Action = ["iam:PassRole"], Resource = local.native_resume_controls[each.key].roles,
    Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
    ] : merge(statement, { Condition = merge(try(statement.Condition, {}), {
      ArnEquals = merge(try(statement.Condition.ArnEquals, {}), { "aws:PrincipalArn" = local.native_resume_controls[each.key].principal })
  }) })] })
  lifecycle {
    precondition {
      condition     = length(local.github_deploy_policy_json) <= 6144
      error_message = "Combined deployment policy exceeds IAM's managed-policy size limit; retain original releases and split reviewed policy composition before adding more."
    }
  }
}
output "native_resume_control_boundary_arns" {
  value = { for revision, policy in aws_iam_policy.native_resume_control_boundary : revision => policy.arn }
}

resource "aws_iam_policy" "native_resume_observer_boundary" {
  for_each    = var.native_resume_control_releases
  name        = "ai-job-apply-${var.environment}-resume-observer-r${each.key}-boundary"
  description = "Original resume observation ceiling without launch or stop authority."
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    for statement in jsondecode(aws_iam_policy.native_resume_control_boundary[each.key].policy).Statement : merge(statement, {
      Condition = merge(statement.Condition, { ArnEquals = merge(statement.Condition.ArnEquals, { "aws:PrincipalArn" = replace(local.native_resume_controls[each.key].principal, "resume-control-", "resume-observer-") }) })
    }) if !contains(["TaskMetadata", "OriginalLaunch", "OriginalRoles"], statement.Sid)
    ], [
    { Sid = "OriginalExecutionMetadata", Effect = "Allow", Action = ["lambda:GetDurableExecution"], Resource = "arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-resume-durable-r${each.key}:*/durable-execution/*",
    Condition = { ArnEquals = { "aws:PrincipalArn" = replace(local.native_resume_controls[each.key].principal, "resume-control-", "resume-observer-") } } },
    { Sid = "RetainFailedObservation", Effect = "Allow", Action = ["sqs:SendMessage"], Resource = each.value.observer_dead_letter_arn,
    Condition = { ArnEquals = { "aws:PrincipalArn" = replace(local.native_resume_controls[each.key].principal, "resume-control-", "resume-observer-") } } },
    { Sid = "EncryptFailedObservation", Effect = "Allow", Action = ["kms:GenerateDataKey"], Resource = each.value.platform_kms_key_arn,
    Condition = { ArnEquals = { "aws:PrincipalArn" = replace(local.native_resume_controls[each.key].principal, "resume-control-", "resume-observer-") } } }
  ]) })
}
output "native_resume_observer_boundary_arns" {
  value = { for revision, policy in aws_iam_policy.native_resume_observer_boundary : revision => policy.arn }
}

resource "aws_iam_policy" "native_resume_durable_boundary" {
  for_each    = { for revision, release in var.native_resume_control_releases : revision => release if release.route != null }
  name        = "ai-job-apply-${var.environment}-resume-durable-r${each.key}-boundary"
  description = "Original resume durable DNS ceiling; no owner SQL or task launch."
  policy = jsonencode({ Version = "2012-10-17", Statement = [for statement in [
    { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:us-east-2:${data.aws_caller_identity.current.account_id}:log-group:/ai-job-apply/${var.environment}/application:*" },
    { Sid = "ConfigurationKey", Effect = "Allow", Action = ["kms:Decrypt"], Resource = each.value.platform_kms_key_arn },
    { Sid = "Checkpoints", Effect = "Allow", Action = ["lambda:CheckpointDurableExecution", "lambda:GetDurableExecutionState"], Resource = "arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-resume-durable-r${each.key}:*" },
    { Sid = "OwnerControl", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = "arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-resume-control-r${each.key}:*" },
    { Sid = "OriginalRecords", Effect = "Allow", Action = ["route53:ChangeResourceRecordSets"], Resource = "arn:aws:route53:::hostedzone/${each.value.route.hosted_zone_id}",
      Condition = {
        "ForAllValues:StringEquals" = { "route53:ChangeResourceRecordSetsRecordTypes" = ["A"], "route53:ChangeResourceRecordSetsActions" = ["CREATE", "DELETE"] },
        "ForAllValues:StringLike"   = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["????????-????-7???-????-????????????.${each.value.route.base_host}"] }
      }
    },
    { Sid = "InspectOriginalZone", Effect = "Allow", Action = ["route53:ListResourceRecordSets"], Resource = "arn:aws:route53:::hostedzone/${each.value.route.hosted_zone_id}" },
    { Sid = "ObserveOriginalChange", Effect = "Allow", Action = ["route53:GetChange"], Resource = "arn:aws:route53:::change/*" }
    ] : merge(statement, { Condition = merge(try(statement.Condition, {}), {
      ArnEquals = { "aws:PrincipalArn" = replace(local.native_resume_controls[each.key].principal, "resume-control-", "resume-durable-") }
  }) })] })
}
