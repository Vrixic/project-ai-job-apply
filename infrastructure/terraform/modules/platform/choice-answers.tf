# Choice answers (ADR-061): choice questions decided by Jev (TypeSafe) for the candidate's own browser.
# Dark by default. The provider key is an operator-populated secret that Terraform never holds; the
# Gateway reads it through the Lambda secrets extension over the private endpoint. The Gateway reaches
# the provider the same way it reaches the narrative-answers provider, and only the fixed TypeSafe API
# host in code.
resource "aws_secretsmanager_secret" "typesafe_api_key" {
  count                   = var.choice_answers_enabled ? 1 : 0
  name                    = "${var.name}/${var.environment}/choice-answers/typesafe-key"
  description             = "Operator-populated TypeSafe API key (plain string) for choice answers; never committed"
  kms_key_id              = aws_kms_key.platform.arn
  recovery_window_in_days = 7
}
