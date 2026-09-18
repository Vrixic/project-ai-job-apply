import { describe, expect, it } from "vitest";
import {
  type AdapterSubmissionResult,
  type ApplicationAttempt,
  AttemptRefusedError,
  type ConfirmationEvidence,
  classifySubmissionResult,
  markDispatched,
  planAttemptStart,
  reconcileAttempt,
  recoverStaleAttempt,
  submissionScopeKey,
} from "./attempt.js";
import { APPLICATION_ID, HASH_A, HASH_B, HASH_C, NOW, PACKET_ID, USER_ID } from "./test-support.js";

const evidence: ConfirmationEvidence = {
  kind: "provider_confirmation_page",
  observedAt: NOW,
  fingerprintSha256: HASH_A,
  adapterId: "greenhouse",
  adapterVersion: "1.0.0",
};

function attempt(overrides: Partial<ApplicationAttempt> = {}): ApplicationAttempt {
  return {
    id: "0192f7c2-0000-7000-8000-0000000000d1",
    applicationId: APPLICATION_ID,
    packetId: PACKET_ID,
    packetHash: HASH_B,
    sequence: 1,
    scopeKey: submissionScopeKey(USER_ID, APPLICATION_ID, HASH_B),
    status: "started",
    adapterId: "greenhouse",
    adapterVersion: "1.0.0",
    startedAt: NOW,
    ...overrides,
  };
}

const valid = { valid: true } as const;

describe("attempt start planning", () => {
  it("requires an approved application with a valid approval", () => {
    const base = { attempts: [], packetHash: HASH_B, approval: valid } as const;
    expect(planAttemptStart({ ...base, applicationStatus: "approved" })).toBe(1);
    for (const status of ["review_required", "submitting", "reconciliation_required"] as const) {
      expect(() => planAttemptStart({ ...base, applicationStatus: status })).toThrow(
        expect.objectContaining({ code: "NOT_APPROVED" }),
      );
    }
    expect(() =>
      planAttemptStart({
        ...base,
        applicationStatus: "approved",
        approval: { valid: false, reasons: ["job_changed"] },
      }),
    ).toThrow(expect.objectContaining({ code: "APPROVAL_INVALID" }));
  });

  it("blocks a duplicate submit for the same packet in every scope-holding state", () => {
    const expectations = {
      started: "ATTEMPT_IN_FLIGHT",
      dispatched: "ATTEMPT_IN_FLIGHT",
      taken_over: "ATTEMPT_IN_FLIGHT",
      ambiguous: "AMBIGUOUS_UNRECONCILED",
      confirmed: "ALREADY_SUBMITTED",
    } as const;
    for (const [status, code] of Object.entries(expectations)) {
      expect(() =>
        planAttemptStart({
          applicationStatus: "approved",
          approval: valid,
          packetHash: HASH_B,
          attempts: [
            { packetHash: HASH_B, status: status as ApplicationAttempt["status"], sequence: 1 },
          ],
        }),
      ).toThrow(expect.objectContaining({ code }));
    }
  });

  it("allows a retry after a no-effect failure or a verified not-submitted reconciliation", () => {
    for (const status of ["failed_no_effect", "abandoned", "reconciled_not_submitted"] as const) {
      expect(
        planAttemptStart({
          applicationStatus: "approved",
          approval: valid,
          packetHash: HASH_B,
          attempts: [{ packetHash: HASH_B, status, sequence: 4 }],
        }),
      ).toBe(5);
    }
  });

  it("does not let attempts for a superseded packet block a new packet", () => {
    expect(
      planAttemptStart({
        applicationStatus: "approved",
        approval: valid,
        packetHash: HASH_C,
        attempts: [{ packetHash: HASH_B, status: "failed_requires_review", sequence: 1 }],
      }),
    ).toBe(2);
  });

  it("derives one stable scope per user, application, and packet", () => {
    const scope = submissionScopeKey(USER_ID, APPLICATION_ID, HASH_B);
    expect(scope).toBe(submissionScopeKey(USER_ID, APPLICATION_ID, HASH_B));
    expect(scope).not.toBe(submissionScopeKey(USER_ID, APPLICATION_ID, HASH_C));
    expect(scope).not.toBe(submissionScopeKey(APPLICATION_ID, USER_ID, HASH_B));
  });
});

describe("write-ahead dispatch", () => {
  it("dispatches exactly once", () => {
    const dispatched = markDispatched(attempt(), NOW);
    expect(dispatched.status).toBe("dispatched");
    expect(() => markDispatched(dispatched, NOW)).toThrow(
      expect.objectContaining({ code: "ALREADY_DISPATCHED" }),
    );
    expect(() => markDispatched(attempt({ status: "failed_no_effect" }), NOW)).toThrow(
      AttemptRefusedError,
    );
  });
});

describe("result classification", () => {
  const dispatched = { status: "dispatched" } as const;
  const notDispatched = { status: "started" } as const;

  it("treats every unclear post-dispatch result as ambiguous, never as a failure", () => {
    for (const kind of [
      "timeout",
      "transport_error",
      "unrecognized_response",
      "adapter_crashed",
      "precondition_failed",
    ] as const) {
      expect(classifySubmissionResult(dispatched, { kind })).toBe("ambiguous");
      expect(classifySubmissionResult(notDispatched, { kind })).toBe("failed_no_effect");
    }
  });

  it("confirms only a dispatched attempt with valid evidence", () => {
    const result: AdapterSubmissionResult = { kind: "confirmed", evidence };
    expect(classifySubmissionResult(dispatched, result)).toBe("confirmed");
    expect(classifySubmissionResult(notDispatched, result)).toBe("ambiguous");
    expect(() =>
      classifySubmissionResult(dispatched, {
        kind: "confirmed",
        evidence: { ...evidence, fingerprintSha256: "nope" },
      }),
    ).toThrow(expect.objectContaining({ code: "EVIDENCE_INVALID" }));
    expect(() =>
      classifySubmissionResult(dispatched, {
        kind: "confirmed",
        evidence: { ...evidence, providerReference: "line\nbreak" },
      }),
    ).toThrow(AttemptRefusedError);
  });

  it("sends explicit rejection to review and challenges to user takeover", () => {
    expect(classifySubmissionResult(dispatched, { kind: "validation_rejected" })).toBe(
      "failed_requires_review",
    );
    expect(classifySubmissionResult(dispatched, { kind: "challenge_required" })).toBe("taken_over");
  });
});

describe("crash and replay recovery", () => {
  const stale = 5 * 60 * 1000;
  const later = new Date(NOW.getTime() + stale);

  it("never re-dispatches a crashed dispatched attempt: it becomes ambiguous", () => {
    const dispatched = markDispatched(attempt(), NOW);
    expect(recoverStaleAttempt(dispatched, new Date(NOW.getTime() + 1), stale).status).toBe(
      "dispatched",
    );
    const recovered = recoverStaleAttempt(dispatched, later, stale);
    expect(recovered.status).toBe("ambiguous");
    expect(recoverStaleAttempt(recovered, later, stale)).toBe(recovered);
  });

  it("releases an attempt that crashed before dispatch without an external effect", () => {
    expect(recoverStaleAttempt(attempt(), later, stale).status).toBe("failed_no_effect");
  });
});

describe("reconciliation", () => {
  const ambiguous = attempt({ status: "ambiguous" });

  it("confirms only with provider or user-attested evidence of the right kind", () => {
    expect(
      reconcileAttempt(ambiguous, { kind: "provider_confirmation", evidence }, NOW).status,
    ).toBe("confirmed");
    expect(() =>
      reconcileAttempt(ambiguous, { kind: "user_attested_submitted", evidence }, NOW),
    ).toThrow(expect.objectContaining({ code: "EVIDENCE_INVALID" }));
    expect(
      reconcileAttempt(
        ambiguous,
        { kind: "user_attested_submitted", evidence: { ...evidence, kind: "user_attested" } },
        NOW,
      ).status,
    ).toBe("confirmed");
  });

  it("allows retry only after verified absence or an acknowledged duplicate risk", () => {
    expect(
      reconcileAttempt(
        ambiguous,
        { kind: "provider_absence_verified", observedAt: NOW, fingerprintSha256: HASH_A },
        NOW,
      ).status,
    ).toBe("reconciled_not_submitted");
    expect(() =>
      reconcileAttempt(
        ambiguous,
        { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: false },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "RECONCILIATION_REFUSED" }));
    expect(
      reconcileAttempt(
        ambiguous,
        { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: true },
        NOW,
      ).status,
    ).toBe("reconciled_not_submitted");
  });

  it("only reconciles ambiguous or taken-over attempts", () => {
    expect(() =>
      reconcileAttempt(
        attempt({ status: "confirmed" }),
        { kind: "provider_confirmation", evidence },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "ILLEGAL_ATTEMPT_TRANSITION" }));
  });
});
