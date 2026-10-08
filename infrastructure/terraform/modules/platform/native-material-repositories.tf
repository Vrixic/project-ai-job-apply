variable "native_material_repositories_enabled" {
  description = "Create immutable image storage for native material runtimes; does not publish images or register/launch tasks."
  type        = bool
  default     = false
  nullable    = false
}

resource "aws_ecr_repository" "native_material" {
  for_each             = var.native_material_repositories_enabled ? toset(["native-material", "native-resume"]) : toset([])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.platform.arn
  }
  image_scanning_configuration {
    scan_on_push = true
  }
  # Original task releases pin digests. Never automatically expire their images.
}

output "native_material_repositories" {
  value = { for name, repository in aws_ecr_repository.native_material : name => {
    arn = repository.arn
    url = repository.repository_url
  } }
}
