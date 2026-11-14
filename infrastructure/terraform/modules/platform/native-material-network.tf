variable "native_material_control_network" {
  description = "Original material launcher/owner network bindings, retained through drain."
  type = map(object({
    address_lookup      = optional(bool, false)
    task_definition_arn = string
    cluster_arn         = string
    database_secret_arn = string
    security_group_ids  = set(string)
  }))
  default  = {}
  nullable = false
  validation {
    condition = length(var.native_material_control_network) <= 4 && alltrue([for id, r in var.native_material_control_network :
      can(regex("^[a-z0-9]{1,12}$", id)) &&
      can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task-definition/${var.name}-${var.environment}-native-material:[1-9][0-9]{0,8}$", r.task_definition_arn)) &&
      can(regex("^arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:cluster/[A-Za-z0-9_-]{1,255}$", r.cluster_arn)) &&
      can(regex("^arn:aws:secretsmanager:us-east-2:${data.aws_caller_identity.current.account_id}:secret:${var.name}/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", r.database_secret_arn)) &&
      length(r.security_group_ids) >= 1 && length(r.security_group_ids) <= 2 && alltrue([for sg in r.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", sg))])
    ]) && (length(var.native_material_control_network) == 0 || data.aws_region.current.region == "us-east-2")
    error_message = "Use original release IDs, task definitions, database secrets, clusters and private control groups in this account/environment."
  }
}
variable "native_material_task_access" {
  description = "Original task owner/secret bindings. Empty groups permit registration before control composition."
  type = map(object({
    owner_function_arn    = string
    tls_secret_arn        = string
    tls_secret_version_id = string
    security_group_ids    = set(string)
  }))
  default  = {}
  nullable = false
  validation {
    condition = length(var.native_material_task_access) <= 4 && alltrue([for revision, r in var.native_material_task_access :
      can(regex("^[1-9][0-9]{0,8}$", revision)) &&
      can(regex("^arn:aws:lambda:us-east-2:${data.aws_caller_identity.current.account_id}:function:${var.name}-${var.environment}-material-owner-[a-z0-9]{1,12}:[1-9][0-9]{0,8}$", r.owner_function_arn)) &&
      alltrue([for arn in [r.tls_secret_arn] : can(regex("^arn:aws:secretsmanager:us-east-2:${data.aws_caller_identity.current.account_id}:secret:${var.name}/${var.environment}/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", arn))]) &&
      alltrue([for version in [r.tls_secret_version_id] : can(regex("^[A-Za-z0-9-]{32,64}$", version))]) &&
      length(r.security_group_ids) <= 2 && alltrue([for sg in r.security_group_ids : can(regex("^sg-[a-f0-9]{17}$", sg))])
    ]) && (length(var.native_material_task_access) == 0 || data.aws_region.current.region == "us-east-2")
    error_message = "Use original numeric task revisions and owner versions, a pinned TLS secret and exact task groups."
  }
}
locals {
  material_address_releases    = { for id, r in var.native_material_control_network : id => r if r.address_lookup }
  material_private_configured  = length(var.native_material_control_network) > 0 || length(var.native_material_task_access) > 0
  material_task_rpc_configured = length(var.native_material_task_access) > 0
  material_control_groups      = sort(distinct(flatten([for r in var.native_material_control_network : tolist(r.security_group_ids)])))
  material_task_groups         = sort(distinct(flatten([for r in var.native_material_task_access : tolist(r.security_group_ids)])))
  material_control_roles       = { for id, r in var.native_material_control_network : id => { for kind in ["launch", "owner"] : kind => "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-material-${kind}-${id}" } }
  material_task_roles          = { for revision, r in var.native_material_task_access : revision => "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-${var.environment}-native-material-r${revision}-task" }
  material_secret_access = merge(
    merge({}, [for id, r in var.native_material_control_network : { for kind in ["launch", "owner"] : "Control${id}${kind}" => { role = local.material_control_roles[id][kind], secret = r.database_secret_arn, version = null } }]...),
    merge({}, [for revision, r in var.native_material_task_access : {
      "Task${revision}Tls" = { role = local.material_task_roles[revision], secret = r.tls_secret_arn, version = r.tls_secret_version_id }
    }]...)
  )
  material_ecs_statements = flatten([for id, r in var.native_material_control_network : [
    { Sid       = "MaterialLaunch${id}", Effect = "Allow", Principal = "*", Action = ["ecs:RunTask"], Resource = r.task_definition_arn,
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.material_control_roles[id].launch, "ecs:cluster" = r.cluster_arn }, Bool = { "ecs:enable-execute-command" = "false" } }
    },
    { Sid       = "MaterialDefinition${id}", Effect = "Allow", Principal = "*", Action = ["ecs:DescribeTaskDefinition"], Resource = "*",
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.material_control_roles[id].launch } }
    },
    { Sid       = "MaterialObservation${id}", Effect = "Allow", Principal = "*", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:us-east-2:${data.aws_caller_identity.current.account_id}:task/${element(reverse(split("/", r.cluster_arn)), 0)}/*",
      Condition = { ArnEquals = { "aws:PrincipalArn" = local.material_control_roles[id].launch, "ecs:cluster" = r.cluster_arn } }
    }
  ]])
}
