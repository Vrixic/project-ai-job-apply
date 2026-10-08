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
}
resource "aws_iam_role_policy" "gateway_native_disposal" {
  count  = length(local.gateway_disposal_clusters) > 0 ? 1 : 0
  name   = "native-application-disposal"
  role   = aws_iam_role.gateway_lambda[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.gateway_disposal_statements })
}
