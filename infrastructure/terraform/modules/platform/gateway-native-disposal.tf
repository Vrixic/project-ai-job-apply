locals {
  gateway_disposal_clusters = var.gateway_native_materials == null ? [] : sort(distinct([for deployment in var.gateway_native_materials.disposal_deployments : deployment.cluster_arn]))
  gateway_disposal_statements = [for index, cluster in local.gateway_disposal_clusters : {
    Sid       = "GatewayNativeDisposal${index}", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"],
    Resource  = "${replace(cluster, ":cluster/", ":task/")}/*",
    Condition = { ArnEquals = { "ecs:cluster" = cluster } }
  }]
  gateway_disposal_endpoint_statements = [for statement in local.gateway_disposal_statements : merge(statement, {
    Principal = "*", Condition = { ArnEquals = merge(statement.Condition.ArnEquals, {
      "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-gateway-lambda"
    }) }
  })]
  # The candidate-rights maintenance function may only DESCRIBE tasks in the clusters that already retain native task
  # deployments (the Gateway's disposal clusters and the cleanup function's), so a resume purge can tell that a bound
  # task no longer exists (Documents migration 0021). It cannot start, stop or exec into anything, and holds no
  # content: ecs:DescribeTasks only, per cluster, on that cluster's tasks.
  candidate_rights_native_task_clusters = sort(distinct(concat(local.gateway_disposal_clusters, local.native_cleanup_clusters)))
  candidate_rights_native_task_statements = [for index, cluster in local.candidate_rights_native_task_clusters : {
    Sid       = "ResumePurgeNativeTaskObservation${index}", Effect = "Allow", Action = ["ecs:DescribeTasks"],
    Resource  = "${replace(cluster, ":cluster/", ":task/")}/*",
    Condition = { ArnEquals = { "ecs:cluster" = cluster } }
  }]
  candidate_rights_native_task_endpoint_statements = !var.candidate_rights_enabled || !var.deploy_profile_readiness_durable ? [] : [for statement in local.candidate_rights_native_task_statements : merge(statement, {
    Principal = "*", Condition = { ArnEquals = merge(statement.Condition.ArnEquals, {
      "aws:PrincipalArn" = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-profile-readiness-activity"
    }) }
  })]
}
resource "aws_iam_role_policy" "gateway_native_disposal" {
  count  = length(local.gateway_disposal_clusters) > 0 ? 1 : 0
  name   = "native-application-disposal"
  role   = aws_iam_role.gateway_lambda[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.gateway_disposal_statements })
}
