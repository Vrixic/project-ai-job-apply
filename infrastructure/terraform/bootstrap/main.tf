data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "aws_kms_key" "state" {
  description             = "Terraform state encryption for ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "state" {
  name          = "alias/ai-job-apply-${var.environment}-terraform"
  target_key_id = aws_kms_key.state.key_id
}

resource "aws_s3_bucket" "state" { # nosemgrep: semgrep-rules.terraform.aws.best-practice.aws-s3-bucket-versioning-not-enabled -- versioning is managed by aws_s3_bucket_versioning.state
  bucket = var.state_bucket_name
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.state.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "retain-noncurrent-state"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_oidc_subject_prefix}:environment:${var.github_environment}"]
    }
  }
}

locals {
  workload_role_arn             = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-*"
  workload_boundary_arn         = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/ai-job-apply-${var.environment}-workload-boundary"
  candidate_document_bucket_arn = "arn:aws:s3:::ai-job-apply-${var.environment}-candidate-docs-*"
  guardduty_managed_rule_arn    = "arn:aws:events:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"

  github_deploy_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "TerraformStateBucket"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      },
      {
        Sid      = "TerraformStateKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = [aws_kms_key.state.arn]
      },
      {
        Sid    = "PlatformInfrastructure"
        Effect = "Allow"
        Action = [
          "apigateway:*",
          "bcm-data-exports:*",
          "budgets:*",
          "cloudwatch:*",
          "cur:PutReportDefinition",
          "ec2:*",
          "ecr:*",
          "ecs:*",
          "elasticache:*",
          "elasticloadbalancing:*",
          "kms:*",
          "logs:*",
          "rds:*",
          "route53:*",
          "s3:*",
          "secretsmanager:*",
          "servicediscovery:*",
          "sqs:*"
        ]
        Resource = "*"
      },
      {
        Sid    = "ManageEnvironmentDurableStack"
        Effect = "Allow"
        Action = [
          "cloudformation:CreateStack",
          "cloudformation:DeleteStack",
          "cloudformation:DescribeStackEvents",
          "cloudformation:DescribeStackResource",
          "cloudformation:DescribeStackResources",
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          "cloudformation:ListStackResources",
          "cloudformation:UpdateStack"
        ]
        Resource = "arn:aws:cloudformation:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:stack/ai-job-apply-${var.environment}-profile-readiness-durable/*"
      },
      {
        Sid      = "ValidateDurableTemplate"
        Effect   = "Allow"
        Action   = ["cloudformation:ValidateTemplate"]
        Resource = "*"
      },
      {
        Sid    = "ManageEnvironmentWorkflowRules"
        Effect = "Allow"
        Action = [
          "events:DeleteRule",
          "events:DescribeRule",
          "events:ListTagsForResource",
          "events:ListTargetsByRule",
          "events:PutRule",
          "events:PutTargets",
          "events:RemoveTargets",
          "events:TagResource",
          "events:UntagResource"
        ]
        Resource = "arn:aws:events:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:rule/ai-job-apply-${var.environment}-*"
      },
      {
        Sid    = "ManageCandidateDocumentMalwarePlans"
        Effect = "Allow"
        Action = [
          "guardduty:CreateMalwareProtectionPlan",
          "guardduty:DeleteMalwareProtectionPlan",
          "guardduty:GetMalwareProtectionPlan",
          "guardduty:ListMalwareProtectionPlans",
          "guardduty:ListTagsForResource",
          "guardduty:TagResource",
          "guardduty:UntagResource",
          "guardduty:UpdateMalwareProtectionPlan"
        ]
        Resource = "*"
      },
      {
        Sid    = "ManageEnvironmentLambda"
        Effect = "Allow"
        Action = ["lambda:*"]
        Resource = [
          "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-*",
          "arn:aws:lambda:${data.aws_region.current.name}:590474943231:layer:AWS-Parameters-and-Secrets-Lambda-Extension:*"
        ]
      },
      {
        Sid      = "CreateBoundedWorkloadRoles"
        Effect   = "Allow"
        Action   = ["iam:CreateRole"]
        Resource = local.workload_role_arn
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = local.workload_boundary_arn
          }
        }
      },
      {
        Sid    = "ManageBoundedWorkloadRoles"
        Effect = "Allow"
        Action = [
          "iam:DeleteRole",
          "iam:DeleteRolePolicy",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:ListRolePolicies",
          "iam:ListRoleTags",
          "iam:PutRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy"
        ]
        Resource = local.workload_role_arn
      },
      {
        Sid      = "AttachApprovedExecutionPolicy"
        Effect   = "Allow"
        Action   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
        Resource = local.workload_role_arn
        Condition = {
          ArnEquals = {
            "iam:PolicyARN" = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
          }
        }
      },
      {
        Sid    = "ReadApprovedPolicies"
        Effect = "Allow"
        Action = ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"]
        Resource = [
          local.workload_boundary_arn,
          "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
        ]
      },
      {
        Sid      = "PassWorkloadRolesToApprovedServices"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = local.workload_role_arn
        Condition = {
          StringEquals = {
            "iam:PassedToService" = [
              "ecs-tasks.amazonaws.com",
              "lambda.amazonaws.com",
              "malware-protection-plan.guardduty.amazonaws.com"
            ]
          }
        }
      },
      {
        Sid      = "CreateRequiredServiceLinkedRoles"
        Effect   = "Allow"
        Action   = ["iam:CreateServiceLinkedRole"]
        Resource = "arn:aws:iam::*:role/aws-service-role/*"
        Condition = {
          StringEquals = {
            "iam:AWSServiceName" = [
              "ecs.amazonaws.com",
              "elasticache.amazonaws.com",
              "rds.amazonaws.com"
            ]
          }
        }
      }
    ]
  }
}

resource "aws_iam_policy" "workload_boundary" {
  name = "ai-job-apply-${var.environment}-workload-boundary"
  # IAM managed-policy descriptions are immutable. Retain this legacy wording to avoid replacing
  # the live boundary while extending its policy document to approved Lambda workloads.
  description = "Maximum runtime permissions for ${var.environment} ECS workload roles."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PullApprovedImages"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/ai-job-apply/*"
      },
      {
        Sid      = "ObtainEcrAuthorization"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "WriteApplicationLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/ai-job-apply/${var.environment}/application:*"
      },
      {
        Sid      = "ReadRuntimeSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:ai-job-apply/${var.environment}/*"
      },
      {
        Sid      = "DecryptTaggedRuntimeData"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project"     = "ai-job-apply"
            "aws:ResourceTag/Environment" = var.environment
          }
        }
      },
      {
        Sid      = "WriteApplicationTraces"
        Effect   = "Allow"
        Action   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
        Resource = "*"
      },
      {
        Sid      = "ConnectExactPublicJobReader"
        Effect   = "Allow"
        Action   = ["rds-db:connect"]
        Resource = "arn:aws:rds-db:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:dbuser:*/ai_job_apply_public_job_reader"
      },
      {
        Sid    = "ManageLambdaVpcInterfaces"
        Effect = "Allow"
        Action = [
          "ec2:AssignPrivateIpAddresses",
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeSubnets",
          "ec2:UnassignPrivateIpAddresses"
        ]
        Resource = "*"
      },
      {
        Sid    = "OperateOwnedServerlessWorkflows"
        Effect = "Allow"
        Action = [
          "lambda:CheckpointDurableExecution",
          "lambda:GetDurableExecutionState",
          "lambda:InvokeFunction"
        ]
        Resource = "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:ai-job-apply-${var.environment}-*:*"
      },
      {
        Sid      = "AssumeOwnedDocumentObjectAccessRole"
        Effect   = "Allow"
        Action   = ["sts:AssumeRole"]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-job-apply-${var.environment}-document-object-access"
      },
      {
        Sid    = "OperateOwnedWorkflowQueues"
        Effect = "Allow"
        Action = [
          "sqs:ChangeMessageVisibility",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage",
          "sqs:SendMessage"
        ]
        Resource = "arn:aws:sqs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:ai-job-apply-${var.environment}-*"
      },
      {
        Sid    = "OperateGuardDutyManagedCandidateDocumentRule"
        Effect = "Allow"
        Action = [
          "events:DeleteRule",
          "events:DescribeRule",
          "events:ListTargetsByRule",
          "events:PutRule",
          "events:PutTargets",
          "events:RemoveTargets"
        ]
        Resource = local.guardduty_managed_rule_arn
      },
      {
        Sid    = "ConfigureCandidateDocumentBucketEvents"
        Effect = "Allow"
        Action = [
          "s3:GetBucketNotification",
          "s3:ListBucket",
          "s3:PutBucketNotification"
        ]
        Resource = local.candidate_document_bucket_arn
      },
      {
        Sid    = "ScanCandidateDocumentObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectTagging",
          "s3:GetObjectVersion",
          "s3:GetObjectVersionTagging",
          "s3:PutObject",
          "s3:PutObjectTagging",
          "s3:PutObjectVersionTagging"
        ]
        Resource = "${local.candidate_document_bucket_arn}/*"
      }
    ]
  })
}

resource "aws_iam_policy" "github_deploy_boundary" {
  name        = "ai-job-apply-${var.environment}-github-deploy-boundary"
  description = "Maximum permissions for the ${var.environment} GitHub deployment role."
  policy      = jsonencode(local.github_deploy_policy)
}

resource "aws_iam_role" "github_deploy" {
  name                 = "ai-job-apply-${var.environment}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  permissions_boundary = aws_iam_policy.github_deploy_boundary.arn
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "terraform-state-and-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = jsonencode(local.github_deploy_policy)
}
