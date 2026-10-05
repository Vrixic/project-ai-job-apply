import type { VaultReference } from "./vault.js";

export type FieldSensitivity = "standard" | "confidential" | "restricted";
export type FieldAnswerPolicy =
  | "deterministic"
  | "confirmed_fact"
  | "explicit_each_time"
  | "never_infer";
export type FieldValue = string | number | boolean | readonly (string | number | boolean)[] | null;

/** Mirrors `packages/domain/schemas/v1/field-definition.schema.json`. */
export interface FieldDefinition {
  key: string;
  label: string;
  valueType: "string" | "text" | "boolean" | "integer" | "decimal" | "date" | "enum" | "file";
  sensitivity: FieldSensitivity;
  answerPolicy: FieldAnswerPolicy;
  allowedValues?: readonly string[];
}

/**
 * Where a proposed value came from. Only `user_entered` and a candidate-confirmed
 * `answer_vault` entry may carry a `never_infer` answer.
 */
export type FieldOrigin =
  | "confirmed_fact"
  | "answer_vault"
  | "user_entered"
  | "generated"
  | "derived";

export type ReviewReason =
  | "restricted_answer"
  | "explicit_each_time"
  | "never_infer"
  | "unsupported_value"
  | "unconfirmed_source"
  | "low_confidence"
  | "generated_content"
  | "unknown_field"
  | "direct_user_action";

/**
 * - `auto`: may be applied without a per-field review decision.
 * - `review`: shown in the final review and needs explicit acknowledgement.
 * - `user_action`: the value must come from the candidate in this review; any proposed value is
 *   dropped from the packet.
 */
export type FieldDisposition = "auto" | "review" | "user_action";

export interface ProposedField {
  vaultReference?: VaultReference;
  fieldKey: string;
  value: FieldValue;
  origin: FieldOrigin;
  sourceFactIds: readonly string[];
  /** True only when every referenced fact/vault entry is currently candidate-confirmed. */
  sourceConfirmed: boolean;
  confidence: number;
}

export interface FieldClassification {
  disposition: FieldDisposition;
  reasons: readonly ReviewReason[];
  /** False when the proposed value must not appear in the packet. */
  usable: boolean;
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.9;

/**
 * Keys whose semantics are consent, identity attestation, or a provider challenge. They are
 * always direct candidate actions (ADR-010): never proposed, never carried across applications.
 */
const DIRECT_ACTION_PREFIXES = ["attestation.", "signature.", "challenge.", "captcha.", "mfa."];

export function isDirectActionField(fieldKey: string): boolean {
  return DIRECT_ACTION_PREFIXES.some((prefix) => fieldKey.startsWith(prefix));
}

export function classifyField(
  definition: FieldDefinition | undefined,
  proposal: ProposedField,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
): FieldClassification {
  const reasons = new Set<ReviewReason>();
  let userAction = false;
  const candidateSupplied = proposal.origin === "user_entered";
  const vaultConfirmed = proposal.origin === "answer_vault" && proposal.sourceConfirmed;

  if (!definition) {
    reasons.add("unknown_field");
    userAction ||= !candidateSupplied;
  }
  if (isDirectActionField(proposal.fieldKey)) {
    reasons.add("direct_user_action");
    userAction ||= !candidateSupplied;
  }
  if (definition?.sensitivity === "restricted") {
    reasons.add("restricted_answer");
  }
  if (definition?.answerPolicy === "never_infer") {
    reasons.add("never_infer");
    if (!candidateSupplied && !vaultConfirmed) userAction = true;
  }
  if (definition?.answerPolicy === "explicit_each_time") {
    reasons.add("explicit_each_time");
  }
  if (!candidateSupplied && proposal.sourceFactIds.length === 0) {
    reasons.add("unsupported_value");
    userAction = true;
  }
  if (!candidateSupplied && proposal.sourceFactIds.length > 0 && !proposal.sourceConfirmed) {
    reasons.add("unconfirmed_source");
    userAction = true;
  }
  if (proposal.origin === "generated") {
    reasons.add("generated_content");
  }
  if (!candidateSupplied && !(proposal.confidence >= confidenceThreshold)) {
    reasons.add("low_confidence");
  }

  const disposition: FieldDisposition = userAction
    ? "user_action"
    : reasons.size || proposal.origin === "answer_vault"
      ? "review"
      : "auto";
  return { disposition, reasons: [...reasons].sort(), usable: disposition !== "user_action" };
}
