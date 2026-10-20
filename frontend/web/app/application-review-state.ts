import type { Application } from "@ai-job-apply/api-contracts";

type PacketField = NonNullable<Application["currentPacket"]>["fields"][number];

export interface ReviewGroups {
  /** Fields the candidate must supply before approval is possible. */
  needsInput: PacketField[];
  /** Every field that requires an explicit acknowledgement, including restricted answers. */
  needsReview: PacketField[];
  /** Fields filled without a per-field decision. Still listed on request. */
  automatic: PacketField[];
}

export function reviewGroups(application: Application): ReviewGroups {
  const fields = application.currentPacket?.fields ?? [];
  return {
    needsInput: fields.filter(
      (field) => field.disposition === "user_action" && field.value === null,
    ),
    needsReview: fields.filter((field) => field.requiresReview),
    automatic: fields.filter((field) => !field.requiresReview),
  };
}

/**
 * The resume file binding is confirmed by the Apply action itself: its identity (generated or
 * uploaded) and, for a generated resume, its exact preview are shown beside the button. Every other
 * answer that needs review keeps its own explicit confirmation.
 */
export const APPLY_CONFIRMED_FIELD_KEY = "documents.resume";

/** Answers the candidate must confirm one by one: everything that needs review except the resume. */
export function explicitReviewFields(groups: ReviewGroups): PacketField[] {
  return groups.needsReview.filter(
    (field) => field.fieldKey !== APPLY_CONFIRMED_FIELD_KEY && field.value !== null,
  );
}

/** Review fields with no value that the candidate cannot fill in: the server would refuse them. */
function unconfirmableFields(groups: ReviewGroups): PacketField[] {
  return groups.needsReview.filter(
    (field) =>
      field.fieldKey !== APPLY_CONFIRMED_FIELD_KEY &&
      field.value === null &&
      !groups.needsInput.includes(field),
  );
}

/** Apply needs every empty direct-action field filled and every explicit review item confirmed. */
export function canApply(groups: ReviewGroups, acknowledged: ReadonlySet<string>): boolean {
  return (
    groups.needsInput.length === 0 &&
    unconfirmableFields(groups).length === 0 &&
    explicitReviewFields(groups).every((field) => acknowledged.has(field.fieldKey))
  );
}

/** Why Apply is not available yet, in fixed value-free copy. */
export function applyBlockers(groups: ReviewGroups, acknowledged: ReadonlySet<string>): string[] {
  const blockers: string[] = [];
  if (groups.needsInput.length > 0) {
    blockers.push(`${groups.needsInput.length} answer(s) still need your input.`);
  }
  if (unconfirmableFields(groups).length > 0) {
    blockers.push(
      "Some answers cannot be confirmed yet. Update your saved answers, then try again.",
    );
  }
  const unacknowledged = explicitReviewFields(groups).filter(
    (field) => !acknowledged.has(field.fieldKey),
  );
  if (unacknowledged.length > 0) {
    blockers.push(`${unacknowledged.length} answer(s) still need your check.`);
  }
  return blockers;
}

/**
 * The acknowledgement the server requires for every reviewable field: the candidate's explicit
 * confirmations plus the resume binding the Apply action confirms. Sorted for a stable request.
 */
export function acknowledgementsForApply(
  groups: ReviewGroups,
  acknowledged: ReadonlySet<string>,
): string[] {
  return groups.needsReview
    .map((field) => field.fieldKey)
    .filter((key) => key === APPLY_CONFIRMED_FIELD_KEY || acknowledged.has(key))
    .sort();
}

/** Fixed, value-free explanations for why a field is shown for review. */
export const REASON_COPY: Record<PacketField["reasons"][number], string> = {
  restricted_answer: "Sensitive answer. It is shown every time. Check it for this application.",
  explicit_each_time: "This answer is confirmed for each application.",
  never_infer: "We never fill this from anything but your own answer.",
  unsupported_value: "We could not support this value from your confirmed profile.",
  unconfirmed_source: "This came from something you have not confirmed yet.",
  low_confidence: "We are not confident about this value.",
  generated_content: "Drafted for you. Read it carefully before applying.",
  unknown_field: "We do not recognize this question.",
  direct_user_action: "You must complete this yourself.",
};

export function formatFieldValue(value: PacketField["value"]): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
