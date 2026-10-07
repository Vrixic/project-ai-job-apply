variable "native_resume_control_releases" {
  description = "Explicit original resume releases approved for private control IAM. Empty preserves existing bootstrap behavior. Keys are original task revisions; retain until trusted drain."
  type = map(object({
    observer_dead_letter_arn = string
    cluster_name             = string
    database_secret_arn      = string
    platform_kms_key_arn     = string
  }))
  default  = {}
  nullable = false
  validation {
    condition = length(var.native_resume_control_releases) <= 4 && alltrue([for revision, release in var.native_resume_control_releases :
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
  native_resume_deploy_statements = flatten([for revision, release in local.native_resume_controls : [
    { Sid = "CreateOriginalResumeControl${revision}", Effect = "Allow", Action = ["iam:CreateRole"], Resource = release.principal,
    Condition = { StringEquals = { "iam:PermissionsBoundary" = release.boundary } } },
    { Sid = "CreateOriginalResumeObserver${revision}", Effect = "Allow", Action = ["iam:CreateRole"], Resource = replace(release.principal, "resume-control-", "resume-observer-"),
    Condition = { StringEquals = { "iam:PermissionsBoundary" = replace(release.boundary, "resume-control-", "resume-observer-") } } },
    { Sid = "ReadOriginalObserverBoundary${revision}", Effect = "Allow", Action = ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"], Resource = replace(release.boundary, "resume-control-", "resume-observer-") },
    { Sid = "ReadOriginalResumeBoundary${revision}", Effect = "Allow", Action = ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"], Resource = release.boundary },
    { Sid    = "ManageOriginalResumeDurable${revision}", Effect = "Allow",
      Action = ["cloudformation:CreateStack", "cloudformation:DeleteStack", "cloudformation:DescribeStackEvents", "cloudformation:DescribeStackResource", "cloudformation:DescribeStackResources", "cloudformation:DescribeStacks", "cloudformation:GetTemplate", "cloudformation:ListStackResources", "cloudformation:UpdateStack"],
    Resource = "arn:aws:cloudformation:us-east-2:${data.aws_caller_identity.current.account_id}:stack/ai-job-apply-${var.environment}-resume-durable-r${revision}/*" }
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
      condition     = length(jsonencode(local.github_deploy_policy)) <= 6144
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
    { Sid = "RetainFailedObservation", Effect = "Allow", Action = ["sqs:SendMessage"], Resource = each.value.observer_dead_letter_arn,
    Condition = { ArnEquals = { "aws:PrincipalArn" = replace(local.native_resume_controls[each.key].principal, "resume-control-", "resume-observer-") } } },
    { Sid = "EncryptFailedObservation", Effect = "Allow", Action = ["kms:GenerateDataKey"], Resource = each.value.platform_kms_key_arn,
    Condition = { ArnEquals = { "aws:PrincipalArn" = replace(local.native_resume_controls[each.key].principal, "resume-control-", "resume-observer-") } } }
  ]) })
}
output "native_resume_observer_boundary_arns" {
  value = { for revision, policy in aws_iam_policy.native_resume_observer_boundary : revision => policy.arn }
}
