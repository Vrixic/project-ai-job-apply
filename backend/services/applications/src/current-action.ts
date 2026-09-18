import type { ApplicationStatus } from "./state-machine.js";

/**
 * The single next thing a candidate can do. It is derived from source truth and never stored, so
 * it cannot drift from the lifecycle or masquerade as a notification/inbox item (ADR-024).
 */
export const currentActions = [
  "prepare_packet",
  "resolve_fields",
  "review_and_approve",
  "re_review",
  "ready_to_submit",
  "submission_in_progress",
  "complete_manually",
  "confirm_submission_status",
  "none",
] as const;
export type CurrentAction = (typeof currentActions)[number];

export interface CurrentActionInput {
  status: ApplicationStatus;
  /** True when the current packet still has a field needing direct candidate action. */
  hasUnresolvedFields: boolean;
  /** True when there is a live approval that has not expired. */
  approvalLive: boolean;
}

export function deriveCurrentAction(input: CurrentActionInput): CurrentAction {
  switch (input.status) {
    case "preparing":
      return "prepare_packet";
    case "review_required":
      return input.hasUnresolvedFields ? "resolve_fields" : "review_and_approve";
    case "approved":
      return input.approvalLive ? "ready_to_submit" : "re_review";
    case "submitting":
      return "submission_in_progress";
    case "takeover":
      return "complete_manually";
    case "reconciliation_required":
      return "confirm_submission_status";
    case "applied":
    case "cancelled":
      return "none";
  }
}
