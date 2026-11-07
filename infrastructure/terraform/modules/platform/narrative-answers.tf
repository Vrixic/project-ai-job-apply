# Narrative answers (ADR-057): short free-text answers drafted by a model for the candidate's own
# browser. Dark by default. The provider key is an operator-populated secret that Terraform never
# holds; the Gateway reads it through the Lambda secrets extension over the private endpoint.
resource "aws_secretsmanager_secret" "openai_api_key" {
  count                   = var.narrative_answers_enabled ? 1 : 0
  name                    = "${var.name}/${var.environment}/narrative-answers/openai-api-key"
  description             = "Operator-populated OpenAI API key (plain string) for narrative answers; never committed"
  kms_key_id              = aws_kms_key.platform.arn
  recovery_window_in_days = 7
}
