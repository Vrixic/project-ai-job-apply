data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

data "aws_iam_policy" "workload_boundary" {
  name = "${var.name}-${var.environment}-workload-boundary"
}

locals {
  azs            = slice(data.aws_availability_zones.available.names, 0, 2)
  private_cidrs  = [cidrsubnet(var.vpc_cidr, 4, 0), cidrsubnet(var.vpc_cidr, 4, 1)]
  public_cidrs   = [cidrsubnet(var.vpc_cidr, 4, 8), cidrsubnet(var.vpc_cidr, 4, 9)]
  container_port = 4000
}

data "aws_iam_policy_document" "platform_kms" {
  statement {
    sid       = "EnableAccountIAMPermissions"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowCloudWatchLogsEncryption"
    effect = "Allow"
    actions = [
      "kms:Decrypt*",
      "kms:Describe*",
      "kms:Encrypt*",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*"
    ]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${data.aws_region.current.name}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = [
        "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/${var.name}/${var.environment}/application*"
      ]
    }
  }
}

resource "aws_kms_key" "platform" {
  description             = "${var.name} ${var.environment} data encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.platform_kms.json
}

resource "aws_kms_alias" "platform" {
  name          = "alias/${var.name}-${var.environment}"
  target_key_id = aws_kms_key.platform.key_id
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.name}-${var.environment}" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = local.public_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-${var.environment}-public-${count.index + 1}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = local.private_cidrs[count.index]
  tags              = { Name = "${var.name}-${var.environment}-private-${count.index + 1}" }
}

resource "aws_eip" "nat" {
  count  = var.private_application_networking ? (var.high_availability ? length(local.azs) : 1) : 0
  domain = "vpc"
}

resource "aws_nat_gateway" "this" {
  count         = var.private_application_networking ? (var.high_availability ? length(local.azs) : 1) : 0
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.this.id
  dynamic "route" {
    for_each = var.private_application_networking ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.this[var.high_availability ? count.index : 0].id
    }
  }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_security_group" "ingress" {
  name_prefix = "${var.name}-${var.environment}-ingress-"
  vpc_id      = aws_vpc.this.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "application" {
  name_prefix = "${var.name}-${var.environment}-app-"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = local.container_port
    to_port         = local.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.ingress.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "data" {
  name_prefix = "${var.name}-${var.environment}-data-"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
  }
  dynamic "ingress" {
    for_each = var.enable_redis ? [1] : []
    content {
      from_port       = 6379
      to_port         = 6379
      protocol        = "tcp"
      security_groups = [aws_security_group.application.id]
    }
  }
}

resource "random_password" "database" {
  length  = 40
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

# ADR-013 keeps prelaunch environments Single-AZ until launch review or measured demand.
resource "aws_db_instance" "postgres" { # nosemgrep: semgrep-rules.terraform.aws.best-practice.aws-rds-multiaz-not-enabled
  identifier                          = "${var.name}-${var.environment}"
  engine                              = "postgres"
  engine_version                      = var.database_engine_version
  instance_class                      = var.database_instance_class
  allocated_storage                   = 20
  max_allocated_storage               = 100
  storage_type                        = "gp3"
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.platform.arn
  multi_az                            = var.high_availability
  iam_database_authentication_enabled = true
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  db_name                             = "ai_job_apply"
  username                            = "platform"
  password                            = random_password.database.result
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.data.id]
  backup_retention_period             = 7
  copy_tags_to_snapshot               = true
  deletion_protection                 = true
  performance_insights_enabled        = var.database_performance_insights
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${var.name}-${var.environment}-final"
}

resource "aws_elasticache_subnet_group" "this" {
  count      = var.enable_redis ? 1 : 0
  name       = "${var.name}-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  count                      = var.enable_redis ? 1 : 0
  replication_group_id       = "${var.name}-${var.environment}"
  description                = "Ephemeral cache and rate limits"
  node_type                  = "cache.t4g.small"
  engine                     = "redis"
  engine_version             = "7.1"
  port                       = 6379
  parameter_group_name       = "default.redis7"
  subnet_group_name          = aws_elasticache_subnet_group.this[0].name
  security_group_ids         = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = var.high_availability
  multi_az_enabled           = var.high_availability
  num_cache_clusters         = var.high_availability ? 2 : 1
  snapshot_retention_limit   = 7
}

resource "aws_s3_bucket" "artifacts" { # nosemgrep: semgrep-rules.terraform.aws.best-practice.aws-s3-bucket-versioning-not-enabled -- versioning is managed by aws_s3_bucket_versioning.artifacts
  bucket_prefix = "${var.name}-${var.environment}-artifacts-"
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.platform.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_sqs_queue" "dead_letter" {
  name                      = "${var.name}-${var.environment}-dead-letter"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.platform.arn
}

resource "aws_sqs_queue" "events" {
  name                       = "${var.name}-${var.environment}-events"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 345600
  kms_master_key_id          = aws_kms_key.platform.arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 5
  })
}

resource "aws_ecr_repository" "gateway" {
  name                 = "${var.name}/gateway"
  image_tag_mutability = "IMMUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.platform.arn
  }
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "worker" {
  name                 = "${var.name}/worker"
  image_tag_mutability = "IMMUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.platform.arn
  }
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecs_cluster" "this" {
  name = "${var.name}-${var.environment}"
  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

resource "aws_cloudwatch_log_group" "application" {
  name              = "/${var.name}/${var.environment}/application"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.platform.arn
}

resource "aws_secretsmanager_secret" "database_url" {
  name       = "${var.name}/${var.environment}/database-url"
  kms_key_id = aws_kms_key.platform.arn
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgres://platform:%s@%s:%s/ai_job_apply?sslmode=require",
    urlencode(random_password.database.result),
    aws_db_instance.postgres.address,
    aws_db_instance.postgres.port
  )
}

resource "aws_secretsmanager_secret" "temporal_api_key" {
  name       = "${var.name}/${var.environment}/temporal-api-key"
  kms_key_id = aws_kms_key.platform.arn
}

data "aws_iam_policy_document" "task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name                 = "${var.name}-${var.environment}-execution"
  assume_role_policy   = data.aws_iam_policy_document.task_assume.json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-runtime-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue", "kms:Decrypt"]
      Resource = [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.temporal_api_key.arn,
        aws_kms_key.platform.arn
      ]
    }]
  })
}

resource "aws_iam_role" "application" {
  name                 = "${var.name}-${var.environment}-application"
  assume_role_policy   = data.aws_iam_policy_document.task_assume.json
  permissions_boundary = data.aws_iam_policy.workload_boundary.arn
}

resource "aws_service_discovery_private_dns_namespace" "application" {
  count = var.deploy_applications ? 1 : 0
  name  = "${var.name}-${var.environment}.internal"
  vpc   = aws_vpc.this.id
}

resource "aws_service_discovery_service" "gateway" {
  count = var.deploy_applications ? 1 : 0
  name  = "gateway"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.application[0].id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_apigatewayv2_vpc_link" "gateway" {
  count              = var.deploy_applications ? 1 : 0
  name               = "${var.name}-${var.environment}-gateway"
  security_group_ids = [aws_security_group.ingress.id]
  subnet_ids         = aws_subnet.private[*].id
}

resource "aws_apigatewayv2_api" "gateway" {
  count         = var.deploy_applications ? 1 : 0
  name          = "${var.name}-${var.environment}-gateway"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "gateway" {
  count                  = var.deploy_applications ? 1 : 0
  api_id                 = aws_apigatewayv2_api.gateway[0].id
  integration_type       = "HTTP_PROXY"
  integration_uri        = aws_service_discovery_service.gateway[0].arn
  integration_method     = "ANY"
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.gateway[0].id
  payload_format_version = "1.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "gateway" {
  count     = var.deploy_applications ? 1 : 0
  api_id    = aws_apigatewayv2_api.gateway[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.gateway[0].id}"
}

resource "aws_apigatewayv2_stage" "gateway" {
  count       = var.deploy_applications ? 1 : 0
  api_id      = aws_apigatewayv2_api.gateway[0].id
  name        = "$default"
  auto_deploy = true
}

resource "aws_ecs_task_definition" "gateway" {
  count                    = var.deploy_applications ? 1 : 0
  family                   = "${var.name}-${var.environment}-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.gateway_cpu
  memory                   = var.gateway_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.application.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name      = "gateway"
    image     = var.gateway_image
    essential = true
    portMappings = [{
      containerPort = local.container_port
      protocol      = "tcp"
    }]
    environment = concat(
      [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(local.container_port) },
        { name = "OIDC_ISSUER", value = var.oidc_issuer },
        { name = "OIDC_AUDIENCE", value = var.oidc_audience },
        { name = "TEMPORAL_ADDRESS", value = var.temporal_address },
        { name = "TEMPORAL_NAMESPACE", value = var.temporal_namespace }
      ],
      var.enable_redis ? [
        { name = "REDIS_URL", value = "rediss://${aws_elasticache_replication_group.redis[0].primary_endpoint_address}:6379" }
      ] : []
    )
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.application.name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "gateway"
      }
    }
  }])
}

resource "aws_ecs_service" "gateway" {
  count           = var.deploy_applications ? 1 : 0
  name            = "gateway"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.gateway[0].arn
  desired_count   = var.gateway_desired_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_application_networking ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.application.id]
    assign_public_ip = !var.private_application_networking
  }

  service_registries {
    registry_arn   = aws_service_discovery_service.gateway[0].arn
    container_name = "gateway"
    container_port = local.container_port
  }
}

resource "aws_ecs_task_definition" "worker" {
  count                    = var.deploy_applications ? 1 : 0
  family                   = "${var.name}-${var.environment}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.application.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name      = "worker"
    image     = var.worker_image
    essential = true
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "TEMPORAL_ADDRESS", value = var.temporal_address },
      { name = "TEMPORAL_NAMESPACE", value = var.temporal_namespace },
      { name = "TEMPORAL_TASK_QUEUE", value = "profile-readiness-v1" },
      { name = "TEMPORAL_TLS", value = "true" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "TEMPORAL_API_KEY", valueFrom = aws_secretsmanager_secret.temporal_api_key.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.application.name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  count           = var.deploy_applications ? 1 : 0
  name            = "workflow-worker"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker[0].arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_application_networking ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.application.id]
    assign_public_ip = !var.private_application_networking
  }
}

resource "aws_ecs_task_definition" "migration" {
  count                    = var.migration_image == "" ? 0 : 1
  family                   = "${var.name}-${var.environment}-database-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name                   = "database-migration"
    image                  = var.migration_image
    essential              = true
    command                = ["backend/services/profile/dist/src/migrate.js"]
    readonlyRootFilesystem = true
    environment = [
      { name = "NODE_ENV", value = "production" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.application.name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "database-migration"
      }
    }
  }])
}

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${var.name}-${var.environment}-database-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Database CPU has remained high."
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }
}

resource "aws_cloudwatch_metric_alarm" "database_free_storage" {
  alarm_name          = "${var.name}-${var.environment}-database-free-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120
  treat_missing_data  = "missing"
  alarm_description   = "Database free storage has remained below 5 GiB."
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }
}

resource "aws_cloudwatch_metric_alarm" "dead_letter_messages" {
  alarm_name          = "${var.name}-${var.environment}-dead-letter-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_description   = "One or more messages are waiting in the dead-letter queue."
  dimensions = {
    QueueName = aws_sqs_queue.dead_letter.name
  }
}

resource "aws_cloudwatch_metric_alarm" "event_queue_age" {
  alarm_name          = "${var.name}-${var.environment}-event-queue-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 300
  treat_missing_data  = "notBreaching"
  alarm_description   = "The oldest event has remained queued for more than five minutes."
  dimensions = {
    QueueName = aws_sqs_queue.events.name
  }
}
