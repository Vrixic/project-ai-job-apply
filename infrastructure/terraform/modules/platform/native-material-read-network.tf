variable "native_material_read_networks" {
  description = "Optional dedicated native task groups. Empty client ranges keep ingress closed; unrestricted access requires an explicit reviewed 0.0.0.0/0. Retain groups until original tasks drain."
  type        = map(object({ client_ipv4_cidrs = optional(set(string), []) }))
  default     = {}
  nullable    = false
  validation {
    condition = alltrue([for kind, network in var.native_material_read_networks :
      contains(["cover_letter", "resume"], kind) && length(network.client_ipv4_cidrs) <= 16 &&
      alltrue([for cidr in network.client_ipv4_cidrs : can(cidrnetmask(cidr)) && try(cidrsubnet(cidr, 0, 0) == cidr, false)])
    ]) && (length(var.native_material_read_networks) == 0 || data.aws_region.current.region == "us-east-2")
    error_message = "Use cover_letter/resume keys and up to sixteen canonical IPv4 CIDRs per original task group in us-east-2."
  }
}

locals {
  native_material_availability_network = var.gateway_native_materials == null ? false : var.gateway_native_materials.availability_enabled
  native_material_read_cidrs = { for kind, network in var.native_material_read_networks : kind => sort(distinct(concat(
    tolist(network.client_ipv4_cidrs),
    local.native_material_availability_network ? [for address in aws_eip.nat : "${address.public_ip}/32"] : []
  ))) }
}

resource "aws_security_group" "native_material_read" {
  for_each    = var.native_material_read_networks
  name_prefix = "${var.name}-${var.environment}-native-${replace(each.key, "_", "-")}-read-"
  description = "Dedicated authenticated native HTTPS task reads"
  vpc_id      = aws_vpc.this.id
  # Explicit empty list withdraws previously configured inline read access.
  ingress = length(local.native_material_read_cidrs[each.key]) == 0 ? [] : [{
    description      = "Reviewed candidate clients and Gateway NAT"
    from_port        = 8443
    to_port          = 8443
    protocol         = "tcp"
    cidr_blocks      = local.native_material_read_cidrs[each.key]
    ipv6_cidr_blocks = []
    prefix_list_ids  = []
    security_groups  = []
    self             = false
  }]
  egress {
    description = "TLS to fixed runtime identity, AWS and approved provider endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

output "native_material_read_network_bindings" {
  description = "Review and copy these scalar bindings into original task launch releases; no task or route is activated."
  value = { for kind, group in aws_security_group.native_material_read : kind => {
    vpc_id                  = aws_vpc.this.id
    task_subnet_ids         = aws_subnet.public[*].id
    task_security_group_ids = [group.id]
    assign_public_ip        = "ENABLED"
    port                    = 8443
  } }
}


variable "native_material_image_access" {
  description = "Exact original native execution roles and repositories admitted by existing private ECR endpoints."
  type        = map(object({ execution_role_arn = string, repository_arn = string, security_group_ids = set(string) }))
  default     = {}
  nullable    = false
  validation {
    condition = length(var.native_material_image_access) <= 8 && alltrue([for id, image in var.native_material_image_access :
      can(regex("^(material|resume)-r[1-9][0-9]{0,8}$", id)) &&
      image.execution_role_arn == "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-native-${id}-execution" &&
      can(regex("^arn:aws:ecr:us-east-2:${data.aws_caller_identity.current.account_id}:repository/ai-job-apply/[a-z0-9]+([._/-][a-z0-9]+)*$", image.repository_arn)) &&
      length(image.security_group_ids) <= 2 && alltrue([for id in image.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", id))])
    ]) && (length(var.native_material_image_access) == 0 || data.aws_region.current.region == "us-east-2")
    error_message = "Use at most eight exact original native execution roles, same-account ECR repositories and task groups."
  }
}
locals {
  native_material_image_groups = sort(distinct(flatten([for image in var.native_material_image_access : tolist(image.security_group_ids)])))
}
resource "aws_security_group" "native_material_image_endpoint" {
  count       = local.migration_task_enabled && length(local.native_material_image_groups) > 0 ? 1 : 0
  name_prefix = "${var.name}-${var.environment}-native-image-endpoint-"
  description = "TLS from original native tasks to private ECR endpoints"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = local.native_material_image_groups
  }
}
