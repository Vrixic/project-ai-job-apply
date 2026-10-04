/**
 * Application lifecycle. `applied` is the terminal success state: the product ends at confirmed
 * submission and never models recruiter replies, interviews, offers, or rejections.
 */
export const applicationStatuses = [
  "preparing",
  "review_required",
  "approved",
  "submitting",
  "takeover",
  "reconciliation_required",
  "applied",
  "cancelled",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

export const terminalStatuses: readonly ApplicationStatus[] = ["applied", "cancelled"];

export const applicationEvents = [
  "packet_created",
  "approved",
  "approval_invalidated",
  "dispatch_refused",
  "attempt_started",
  "attempt_failed_no_effect",
  "attempt_failed_requires_review",
  "takeover_requested",
  "takeover_abandoned",
  "submission_confirmed",
  "submission_ambiguous",
  "reconciled_not_submitted",
  "cancelled",
] as const;
export type ApplicationEvent = (typeof applicationEvents)[number];

const transitions: Readonly<
  Record<ApplicationStatus, Partial<Record<ApplicationEvent, ApplicationStatus>>>
> = {
  preparing: { packet_created: "review_required", cancelled: "cancelled" },
  review_required: {
    // A new packet version supersedes the previous one; approval never carries over.
    packet_created: "review_required",
    approved: "approved",
    cancelled: "cancelled",
  },
  approved: {
    approval_invalidated: "review_required",
    attempt_started: "submitting",
    cancelled: "cancelled",
  },
  submitting: {
    // Write-ahead dispatch may discover stale approval before any provider effect.
    dispatch_refused: "review_required",
    attempt_failed_no_effect: "approved",
    attempt_failed_requires_review: "review_required",
    takeover_requested: "takeover",
    submission_confirmed: "applied",
    submission_ambiguous: "reconciliation_required",
  },
  takeover: {
    takeover_abandoned: "approved",
    submission_confirmed: "applied",
    submission_ambiguous: "reconciliation_required",
  },
  reconciliation_required: {
    submission_confirmed: "applied",
    reconciled_not_submitted: "approved",
  },
  applied: {},
  cancelled: {},
};

export class IllegalTransitionError extends Error {
  readonly from: ApplicationStatus;
  readonly event: ApplicationEvent;

  constructor(from: ApplicationStatus, event: ApplicationEvent) {
    super(`Event ${event} is not allowed while the application is ${from}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.event = event;
  }
}

export function nextStatus(from: ApplicationStatus, event: ApplicationEvent): ApplicationStatus {
  const to = transitions[from][event];
  if (!to) throw new IllegalTransitionError(from, event);
  return to;
}

/** Every (from, to) status pair the lifecycle permits. The database guard must match it exactly. */
export function allowedStatusPairs(): Array<[ApplicationStatus, ApplicationStatus]> {
  const pairs = new Set<string>();
  for (const from of applicationStatuses) {
    for (const to of Object.values(transitions[from])) {
      if (to !== from) pairs.add(`${from}>${to}`);
    }
  }
  return [...pairs].sort().map((pair) => pair.split(">") as [ApplicationStatus, ApplicationStatus]);
}

export function canTransition(from: ApplicationStatus, event: ApplicationEvent): boolean {
  return transitions[from][event] !== undefined;
}

export function isTerminal(status: ApplicationStatus): boolean {
  return terminalStatuses.includes(status);
}

/**
 * Technical history kinds. The set is closed and hiring outcomes are excluded by construction;
 * `assertHistoryKind` additionally refuses outcome vocabulary so a future edit cannot smuggle one in.
 */
export const historyKinds = [
  "application_created",
  "packet_created",
  "approval_recorded",
  "approval_invalidated",
  "attempt_started",
  "attempt_dispatched",
  "attempt_failed_no_effect",
  "attempt_failed_requires_review",
  "takeover_requested",
  "takeover_abandoned",
  "submission_ambiguous",
  "reconciliation_recorded",
  "submission_confirmed",
  "application_cancelled",
] as const;
export type HistoryKind = (typeof historyKinds)[number];

const OUTCOME_VOCABULARY =
  /interview|offer|reject|recruiter|hired|screening|shortlist|ghost|callback|assessment_result/i;

export class ForbiddenHistoryKindError extends Error {
  constructor() {
    super("History kinds cannot describe post-submission hiring outcomes");
    this.name = "ForbiddenHistoryKindError";
  }
}

export function assertHistoryKind(kind: string): asserts kind is HistoryKind {
  if (OUTCOME_VOCABULARY.test(kind) || !(historyKinds as readonly string[]).includes(kind)) {
    throw new ForbiddenHistoryKindError();
  }
}
