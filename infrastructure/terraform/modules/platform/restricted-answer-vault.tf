# Restricted answer vault (ADR-010, D3-001): a dedicated key, separate from the shared platform key
# that also encrypts the database itself. Root delegates authorization to IAM; the normal grant is the
# gateway Lambda role's own Encrypt/Decrypt statement in main.tf, scoped to this key alone. A
# separately default-off candidate-export gate grants the private rights activity Decrypt only,
# restricted to the existing vault encryption-context purpose.

data "aws_iam_policy_document" "restricted_answer_vault_kms" {
  count = var.restricted_answer_vault_enabled ? 1 : 0

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
}

resource "aws_kms_key" "restricted_answer_vault" {
  count                   = var.restricted_answer_vault_enabled ? 1 : 0
  description             = "${var.name} ${var.environment} restricted-answer vault (ADR-010)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.restricted_answer_vault_kms[0].json
}

resource "aws_kms_alias" "restricted_answer_vault" {
  count         = var.restricted_answer_vault_enabled ? 1 : 0
  name          = "alias/${var.name}-${var.environment}-restricted-answer-vault"
  target_key_id = aws_kms_key.restricted_answer_vault[0].key_id
}
