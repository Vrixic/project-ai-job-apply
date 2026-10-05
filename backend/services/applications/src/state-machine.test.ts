import { describe, expect, it } from "vitest";
import {
  applicationEvents,
  applicationStatuses,
  assertHistoryKind,
  canTransition,
  ForbiddenHistoryKindError,
  historyKinds,
  IllegalTransitionError,
  isTerminal,
  nextStatus,
} from "./state-machine.js";

describe("application state machine", () => {
  it("walks the happy path to the terminal applied state", () => {
    let status = nextStatus("preparing", "packet_created");
    status = nextStatus(status, "approved");
    status = nextStatus(status, "attempt_started");
    status = nextStatus(status, "submission_confirmed");
    expect(status).toBe("applied");
    expect(isTerminal(status)).toBe(true);
  });

  it("has no outgoing transitions from terminal states", () => {
    for (const status of ["applied", "cancelled"] as const) {
      for (const event of applicationEvents) {
        expect(canTransition(status, event)).toBe(false);
        expect(() => nextStatus(status, event)).toThrow(IllegalTransitionError);
      }
    }
  });

  it("never allows a second submission after an ambiguous result without reconciliation", () => {
    const ambiguous = nextStatus("submitting", "submission_ambiguous");
    expect(ambiguous).toBe("reconciliation_required");
    expect(canTransition(ambiguous, "attempt_started")).toBe(false);
    expect(canTransition(ambiguous, "cancelled")).toBe(false);
    expect(nextStatus(ambiguous, "reconciled_not_submitted")).toBe("approved");
    expect(nextStatus(ambiguous, "submission_confirmed")).toBe("applied");
  });

  it("only starts an attempt from an approved application", () => {
    for (const status of applicationStatuses) {
      expect(canTransition(status, "attempt_started")).toBe(status === "approved");
    }
  });

  it("returns to review when approval is invalidated and supersedes packets in review", () => {
    expect(nextStatus("approved", "approval_invalidated")).toBe("review_required");
    expect(nextStatus("submitting", "dispatch_refused")).toBe("review_required");
    expect(canTransition("submitting", "approval_invalidated")).toBe(false);
    expect(nextStatus("review_required", "packet_created")).toBe("review_required");
    expect(canTransition("approved", "packet_created")).toBe(false);
  });

  it("cannot cancel once a submission is in flight", () => {
    for (const status of ["submitting", "takeover", "reconciliation_required"] as const) {
      expect(canTransition(status, "cancelled")).toBe(false);
    }
  });
});

describe("technical history kinds", () => {
  it("accepts only the closed technical set", () => {
    for (const kind of historyKinds) expect(() => assertHistoryKind(kind)).not.toThrow();
  });

  it("refuses hiring-outcome vocabulary and unknown kinds", () => {
    for (const kind of [
      "interview_scheduled",
      "offer_received",
      "rejected",
      "recruiter_reply",
      "hired",
      "unknown_kind",
    ]) {
      expect(() => assertHistoryKind(kind)).toThrow(ForbiddenHistoryKindError);
    }
  });

  it("contains no kind that reads as an outcome", () => {
    expect(historyKinds.some((kind) => /interview|offer|reject|recruiter|hired/.test(kind))).toBe(
      false,
    );
  });
});
