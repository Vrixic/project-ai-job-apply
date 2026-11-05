import type { ApplicationFormModel, FormField } from "./form-model.js";
import { type FieldMapping, mapFormFields } from "./mapping.js";

export type PlannedValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[]
  | null;

/** A packet field as the planner sees it. Values come only from the approved packet. */
export interface PacketValue {
  fieldKey: string;
  value: PlannedValue;
  /** True when the field needs direct candidate action and has no candidate-supplied value. */
  needsUserAction: boolean;
}

export type PlanAction =
  | { kind: "fill"; ref: string; fieldKey: string; value: string | number | boolean }
  | { kind: "select"; ref: string; fieldKey: string; option: string }
  | {
      kind: "attach_artifact";
      ref: string;
      fieldKey: "documents.resume" | "documents.cover_letter";
    }
  | {
      kind: "require_user";
      ref: string;
      fieldKey: string | null;
      reason:
        | "unmapped_required"
        | "ambiguous_mapping"
        | "no_packet_value"
        | "needs_user_action"
        | "option_not_found"
        | "direct_action_field"
        | "unsupported_control"
        | "low_confidence";
    }
  | { kind: "skip"; ref: string; reason: "unmapped_optional" | "ambiguous_optional" };

export interface FillPlan {
  actions: PlanAction[];
  /** A challenge (CAPTCHA/MFA) is present: the candidate must take over; it is never bypassed. */
  requiresTakeover: boolean;
  /** Required controls the candidate still has to complete. */
  unresolvedRequired: string[];
}

// Consent, signatures and challenges are never automated, whatever the packet holds. Answers the
// candidate set (work authorization, sponsorship, disclosures, voluntary self-identification) are
// ordinary answers: the planner fills them when the approved packet carries a value. The owner
// removed the restricted-answer rule on 2026-11-05; this supersedes D3-013's threshold for them.
const DIRECT_ACTION_PREFIXES = ["attestation.", "signature.", "challenge.", "captcha.", "mfa."];
const MIN_CONFIDENCE = 0.8;

function optionMatch(field: FormField, value: string): string | undefined {
  const wanted = value.trim().toLowerCase();
  const matches = field.options.filter((option) => option.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Builds the actions an extension may perform on the page. It only ever plans a value that is in
 * the approved packet, matches a control exactly, and is not a direct-action field. Anything else
 * is handed back to the candidate; nothing is guessed, coerced to a nearest option, or bypassed.
 */
export function buildFillPlan(
  form: ApplicationFormModel,
  packet: readonly PacketValue[],
  artifacts: { resume: boolean; coverLetter: boolean },
): FillPlan {
  const mappings = new Map(mapFormFields(form).map((mapping) => [mapping.ref, mapping]));
  const values = new Map(packet.map((entry) => [entry.fieldKey, entry]));
  const actions: PlanAction[] = [];
  const unresolved: string[] = [];

  for (const field of form.fields) {
    const mapping = mappings.get(field.ref) as FieldMapping;
    const requireUser = (
      reason: Extract<PlanAction, { kind: "require_user" }>["reason"],
      fieldKey: string | null,
    ) => {
      actions.push({ kind: "require_user", ref: field.ref, fieldKey, reason });
      if (field.required) unresolved.push(field.ref);
    };

    // A challenge never blocks preparing the form: ordinary fills and attachments are still planned
    // (ADR-046 amendment). It only forces takeover, so the candidate completes the challenge and
    // submits themselves; `requiresTakeover` below forbids any automated submission.

    if (mapping.reason === "unmapped" || mapping.reason === "ambiguous") {
      if (field.required) {
        requireUser(
          mapping.reason === "ambiguous" ? "ambiguous_mapping" : "unmapped_required",
          null,
        );
      } else {
        actions.push({
          kind: "skip",
          ref: field.ref,
          reason: mapping.reason === "ambiguous" ? "ambiguous_optional" : "unmapped_optional",
        });
      }
      continue;
    }
    const fieldKey = mapping.fieldKey as string;
    if (DIRECT_ACTION_PREFIXES.some((prefix) => fieldKey.startsWith(prefix))) {
      requireUser("direct_action_field", fieldKey);
      continue;
    }
    if (mapping.confidence < MIN_CONFIDENCE) {
      requireUser("low_confidence", fieldKey);
      continue;
    }
    if (field.type === "file") {
      const available =
        (fieldKey === "documents.resume" && artifacts.resume) ||
        (fieldKey === "documents.cover_letter" && artifacts.coverLetter);
      if (available) {
        actions.push({
          kind: "attach_artifact",
          ref: field.ref,
          fieldKey: fieldKey as "documents.resume" | "documents.cover_letter",
        });
      } else {
        requireUser("no_packet_value", fieldKey);
      }
      continue;
    }
    if (field.type === "unknown") {
      requireUser("unsupported_control", fieldKey);
      continue;
    }
    const entry = values.get(fieldKey);
    if (!entry) {
      requireUser("no_packet_value", fieldKey);
      continue;
    }
    if (entry.needsUserAction || entry.value === null) {
      requireUser("needs_user_action", fieldKey);
      continue;
    }
    const value = entry.value;
    if (field.type === "select" || field.type === "radio") {
      // A Yes/No answer is a boolean in the packet and the words Yes and No on the page.
      const wanted = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
      const option = typeof wanted === "string" ? optionMatch(field, wanted) : undefined;
      if (option === undefined) requireUser("option_not_found", fieldKey);
      else actions.push({ kind: "select", ref: field.ref, fieldKey, option });
      continue;
    }
    if (field.type === "checkbox") {
      if (typeof value === "boolean")
        actions.push({ kind: "fill", ref: field.ref, fieldKey, value });
      else requireUser("unsupported_control", fieldKey);
      continue;
    }
    if (Array.isArray(value)) {
      requireUser("unsupported_control", fieldKey);
      continue;
    }
    actions.push({
      kind: "fill",
      ref: field.ref,
      fieldKey,
      // A Yes/No answer typed into a plain field is the words, not "true" or "false".
      value: typeof value === "boolean" ? (value ? "Yes" : "No") : (value as string | number),
    });
  }
  return { actions, requiresTakeover: form.challengePresent, unresolvedRequired: unresolved };
}

export interface AssistedPlan {
  mode: "assisted_manual";
  /** No page action is performed. Suggestions are shown for the candidate to apply themselves. */
  performsPageActions: false;
  submissionAllowed: false;
  requiresTakeover: boolean;
  suggestions: Array<{ ref: string; fieldKey: string }>;
  unmatched: string[];
}

/**
 * Conservative fallback for an unknown or custom site: recognize what can be recognized, act on
 * nothing, allow no automated submission, and leave the candidate in control.
 */
export function planAssistedManual(form: ApplicationFormModel): AssistedPlan {
  const mappings = mapFormFields(form);
  return {
    mode: "assisted_manual",
    performsPageActions: false,
    submissionAllowed: false,
    requiresTakeover: form.challengePresent,
    suggestions: mappings
      .filter((mapping) => mapping.reason === "matched" && mapping.confidence >= MIN_CONFIDENCE)
      .map((mapping) => ({ ref: mapping.ref, fieldKey: mapping.fieldKey as string })),
    unmatched: mappings
      .filter((mapping) => mapping.reason !== "matched")
      .map((mapping) => mapping.ref),
  };
}
