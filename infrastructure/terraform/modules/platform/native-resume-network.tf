variable "native_resume_control_network" {
  description = "Original private control/observer API access. Retain every original revision until drain."
  type = map(object({
    cluster_arn        = string
    security_group_ids = set(string)
    address_lookup     = optional(bool, false)
  }))
  default  = {}
  nullable = false
  validation {
    condition = alltrue([for revision, release in var.native_resume_control_network :
      can(regex("^[1-9][0-9]{0,8}$", revision)) &&
      can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", release.cluster_arn)) &&
      length(release.security_group_ids) >= 1 && length(release.security_group_ids) <= 2 &&
      alltrue([for id in release.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))])
    ]) && (length(var.native_resume_control_network) == 0 || data.aws_region.current.region == "us-east-2")
    error_message = "Use original numeric revisions, same-account us-east-2 clusters and one or two exact control security groups."
  }
}
locals {
  native_resume_api_configured   = length(var.native_resume_control_network) > 0 && var.persistent_data_plane_enabled
  native_resume_address_releases = { for revision, release in var.native_resume_control_network : revision => release if release.address_lookup }
  native_resume_api_principals = { for revision, release in var.native_resume_control_network : revision => {
    control  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-resume-control-r${revision}"
    observer = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-resume-observer-r${revision}"
  } }
  native_resume_ecs_endpoint_policy = { Version = "2012-10-17", Statement = flatten([for revision, release in var.native_resume_control_network : [
    { Sid       = "OriginalLaunch${revision}", Effect = "Allow", Principal = "*", Action = ["ecs:RunTask"],
      Resource  = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task-definition/${var.name}-${var.environment}-native-resume:${revision}",
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.native_resume_api_principals[revision].control, "ecs:cluster" = release.cluster_arn }, Bool = { "ecs:enable-execute-command" = "false" } }
    },
    { Sid       = "OriginalDefinition${revision}", Effect = "Allow", Principal = "*", Action = ["ecs:DescribeTaskDefinition"], Resource = "*",
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.native_resume_api_principals[revision].control } }
    },
    { Sid       = "OriginalObservation${revision}", Effect = "Allow", Principal = "*", Action = ["ecs:DescribeTasks"],
      Resource  = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task/${element(reverse(split("/", release.cluster_arn)), 0)}/*",
      Condition = { ArnEquals = { "aws:PrincipalArn" = values(local.native_resume_api_principals[revision]), "ecs:cluster" = release.cluster_arn } }
    }
  ]]) }
  native_resume_ec2_endpoint_policy = { Version = "2012-10-17", Statement = [for revision, release in local.native_resume_address_releases :
    { Sid       = "OriginalAddress${revision}", Effect = "Allow", Principal = "*", Action = ["ec2:DescribeNetworkInterfaces"], Resource = "*",
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.native_resume_api_principals[revision].control } }
    }
  ] }
}
resource "aws_security_group" "native_resume_api" {
  count       = local.native_resume_api_configured ? 1 : 0
  name_prefix = "${var.name}-${var.environment}-resume-api-"
  description = "TLS from original resume control and observer functions"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = sort(distinct(flatten([for release in values(var.native_resume_control_network) : tolist(release.security_group_ids)])))
  }
}
resource "aws_vpc_endpoint" "native_resume_api" {
  for_each            = local.native_resume_api_configured ? toset(concat(["ecs"], length(local.native_resume_address_releases) > 0 ? ["ec2"] : [])) : toset([])
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [aws_subnet.private[0].id]
  security_group_ids  = [aws_security_group.native_resume_api[0].id]
  policy              = each.key == "ecs" ? jsonencode(local.native_resume_ecs_endpoint_policy) : jsonencode(local.native_resume_ec2_endpoint_policy)
}
