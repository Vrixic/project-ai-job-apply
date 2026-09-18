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

/** Approval needs every empty direct-action field filled and every reviewable field acknowledged. */
export function canApprove(groups: ReviewGroups, acknowledged: ReadonlySet<string>): boolean {
  return (
    groups.needsInput.length === 0 &&
    groups.needsReview.every((field) => acknowledged.has(field.fieldKey))
  );
}

export function approvalBlockers(
  groups: ReviewGroups,
  acknowledged: ReadonlySet<string>,
): string[] {
  const blockers: string[] = [];
  if (groups.needsInput.length > 0) {
    blockers.push(`${groups.needsInput.length} answer(s) still need your input.`);
  }
  const unacknowledged = groups.needsReview.filter((field) => !acknowledged.has(field.fieldKey));
  if (unacknowledged.length > 0) {
    blockers.push(`${unacknowledged.length} item(s) still need your confirmation.`);
  }
  return blockers;
}

/** Fixed, value-free explanations for why a field is shown for review. */
export const REASON_COPY: Record<PacketField["reasons"][number], string> = {
  restricted_answer: "Sensitive answer. It is shown every time and only used because you saved it.",
  explicit_each_time: "This answer is confirmed for each application.",
  never_infer: "We never fill this from anything but your own answer.",
  unsupported_value: "We could not support this value from your confirmed profile.",
  unconfirmed_source: "This came from something you have not confirmed yet.",
  low_confidence: "We are not confident about this value.",
  generated_content: "Drafted for you. Read it carefully before approving.",
  unknown_field: "We do not recognize this question.",
  direct_user_action: "You must complete this yourself.",
};

export function formatFieldValue(value: PacketField["value"]): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export const APPROVAL_EXPIRY_NOTE =
  "Approval covers exactly this packet. If the job, the form, or your documents change, or after 24 hours, you will be asked again.";
