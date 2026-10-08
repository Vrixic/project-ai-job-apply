variable "native_material_dns_enabled" {
  description = "Provision the dedicated development download DNS zone; requires parent delegation in Cloudflare and does not activate native tasks."
  type        = bool
  default     = false
  nullable    = false
}

resource "aws_route53_zone" "native_material" {
  count         = var.native_material_dns_enabled ? 1 : 0
  name          = "materials.dev.applydash.ai"
  comment       = "Development-only native application material routes; parent DNS remains in Cloudflare."
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

output "native_material_dns" {
  description = "Public delegation details; add these NS records for materials.dev in the Cloudflare applydash.ai zone."
  value = var.native_material_dns_enabled ? {
    hosted_zone_id = aws_route53_zone.native_material[0].zone_id
    base_host      = aws_route53_zone.native_material[0].name
    name_servers   = aws_route53_zone.native_material[0].name_servers
  } : null
}
