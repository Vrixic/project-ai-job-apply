import { describe, expect, it, vi } from "vitest";
import { TrustApplicationError } from "./application.js";
import {
  AutomatedSourceVetting,
  type VettingAssessment,
  type VettingAuditRecord,
} from "./automated-vetting.js";
import type { TrustCase } from "./policy.js";

const REVIEWER = "019d04cf-1f80-7000-8000-00000000a001";
const CASE_ID = "019d04cf-1f80-8000-8000-00000000c001";
const CONTRIBUTION = "019d04cf-1f80-7000-8000-00000000d001";
const DIGEST = "a".repeat(64);
const model = { provider: "synthetic", model: "synthetic", version: "1" };

const trustCase = (state: TrustCase["state"] = "needs_review"): TrustCase =>
  ({
    id: CASE_ID,
    contributionId: CONTRIBUTION,
    contributorUserId: "019d04cf-1f80-7000-8000-00000000b001",
    state,
    version: 3,
  }) as TrustCase;

const assessment = (overrides: Partial<VettingAssessment> = {}): VettingAssessment => ({
  decision: "accept",
  concerns: [],
  confidence: 0.95,
  model,
  promptId: "source-vetting",
  promptVersion: "source-vetting-v1",
  ...overrides,
});

function setup(
  options: {
    enabled?: boolean;
    state?: TrustCase["state"];
    assessed?: VettingAssessment | Error;
    decide?: () => Promise<unknown>;
    auditFails?: "assessed" | "outcome";
    already?: boolean;
  } = {},
) {
  const records: VettingAuditRecord[] = [];
  const application = {
    readReviewerCase: vi.fn(async () => trustCase(options.state)),
    readReviewerEvidence: vi.fn(async () => ({
      caseId: CASE_ID,
      caseVersion: 3,
      evidence: {
        contributionId: CONTRIBUTION,
        evidenceDigestSha256: DIGEST,
        verifiedAt: "2026-10-22T00:00:00.000Z",
        provider: "greenhouse" as const,
        sourceUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
        title: "Backend Engineer",
        companyName: "Acme",
        description: "Build services.",
        locations: ["Remote"],
      },
    })),
    decideInitialReview: vi.fn(options.decide ?? (async () => trustCase("accepted"))),
    listReviewerCases: vi.fn(async () => ({ items: [trustCase()] })),
  };
  const assessor = {
    assess: vi.fn(async () => {
      const value = options.assessed ?? assessment();
      if (value instanceof Error) throw value;
      return value;
    }),
  };
  const audit = {
    record: vi.fn(async (entry: VettingAuditRecord) => {
      if (options.auditFails === entry.kind) throw new Error("audit down");
      records.push(entry);
    }),
    hasAssessed: vi.fn(async () => options.already === true),
  };
  const service = new AutomatedSourceVetting({
    application: application as never,
    assessor,
    audit,
    reviewerId: REVIEWER,
    enabled: () => options.enabled !== false,
    promptVersion: "source-vetting-v1",
    now: () => new Date("2026-10-22T12:00:00.000Z"),
  });
  return { service, application, assessor, audit, records };
}

describe("AutomatedSourceVetting (ADR-054)", () => {
  it("does nothing at all while the kill switch is off", async () => {
    const { service, application, assessor, audit } = setup({ enabled: false });
    await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome: "disabled" });
    await expect(service.vetPending()).resolves.toEqual({ examined: 0, results: [] });
    expect(application.readReviewerCase).not.toHaveBeenCalled();
    expect(application.listReviewerCases).not.toHaveBeenCalled();
    expect(assessor.assess).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("accepts a clean, confident assessment through the ordinary initial-review path", async () => {
    const { service, application, records } = setup();
    await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome: "accepted" });
    expect(application.decideInitialReview).toHaveBeenCalledWith({
      reviewerId: REVIEWER,
      caseId: CASE_ID,
      expectedVersion: 3,
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: DIGEST,
    });
    expect(records.map((record) => [record.kind, record.outcome])).toEqual([
      ["assessed", undefined],
      ["outcome", "accepted"],
    ]);
    // The audit holds identifiers and enumerations, never posting text.
    expect(JSON.stringify(records)).not.toContain("Build services");
  });

  it.each([
    ["a defer", assessment({ decision: "defer" })],
    ["a concern", assessment({ concerns: ["possible_scam"] })],
    ["low confidence", assessment({ confidence: 0.89 })],
    ["a non-finite confidence", assessment({ confidence: Number.NaN })],
  ])("leaves %s in the human queue and never decides", async (_name, value) => {
    const { service, application, records } = setup({ assessed: value });
    await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome: "deferred" });
    expect(application.decideInitialReview).not.toHaveBeenCalled();
    expect(records.at(-1)).toMatchObject({ kind: "outcome", outcome: "deferred" });
  });

  it("can never reject: the only decision it can make is an acceptance", async () => {
    const { service, application } = setup({
      assessed: assessment({ decision: "defer", concerns: ["possible_scam", "requests_payment"] }),
    });
    await service.vet(CASE_ID);
    for (const call of application.decideInitialReview.mock.calls as unknown as {
      outcome: string;
    }[][])
      expect(call[0]?.outcome).toBe("accepted");
    expect(application.decideInitialReview).not.toHaveBeenCalled();
  });

  it("skips a case that is not waiting for review", async () => {
    const { service, assessor } = setup({ state: "accepted" });
    await expect(service.vet(CASE_ID)).resolves.toEqual({
      caseId: CASE_ID,
      outcome: "not_pending",
    });
    expect(assessor.assess).not.toHaveBeenCalled();
  });

  it("does not send the same evidence to the model twice when the sink remembers it", async () => {
    const { service, assessor } = setup({ already: true });
    await expect(service.vet(CASE_ID)).resolves.toEqual({
      caseId: CASE_ID,
      outcome: "already_assessed",
    });
    expect(assessor.assess).not.toHaveBeenCalled();
  });

  it("makes no decision when the assessment cannot be recorded first", async () => {
    const { service, application } = setup({ auditFails: "assessed" });
    await expect(service.vet(CASE_ID)).resolves.toEqual({
      caseId: CASE_ID,
      outcome: "unavailable",
    });
    expect(application.decideInitialReview).not.toHaveBeenCalled();
  });

  it("reports a model failure as unavailable and decides nothing", async () => {
    const { service, application, audit } = setup({ assessed: new Error("model down") });
    await expect(service.vet(CASE_ID)).resolves.toEqual({
      caseId: CASE_ID,
      outcome: "unavailable",
    });
    expect(application.decideInitialReview).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["version_conflict", "conflict"],
    ["evidence_not_verified", "deferred"],
    ["access_denied", "unavailable"],
    ["dependency_unavailable", "unavailable"],
  ] as const)(
    "maps a Trust refusal %s to %s without any adverse decision",
    async (code, outcome) => {
      const { service, records } = setup({
        decide: async () => {
          throw new TrustApplicationError(code);
        },
      });
      await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome });
      expect(records.at(-1)).toMatchObject({ kind: "outcome", outcome });
    },
  );

  it("still reports the accepted decision if the final audit write fails", async () => {
    const { service } = setup({ auditFails: "outcome" });
    await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome: "accepted" });
  });

  it("vets a bounded pass of pending cases, one at a time", async () => {
    const { service, application } = setup();
    const pass = await service.vetPending(3);
    expect(application.listReviewerCases).toHaveBeenCalledWith({
      reviewerId: REVIEWER,
      state: "needs_review",
      pageSize: 3,
    });
    expect(pass).toEqual({ examined: 1, results: [{ caseId: CASE_ID, outcome: "accepted" }] });
  });

  it("requires an explicit reviewer identity and never lowers the confidence bar", () => {
    expect(
      () =>
        new AutomatedSourceVetting({
          application: {} as never,
          assessor: { assess: vi.fn() },
          audit: { record: vi.fn() },
          reviewerId: "not-a-uuid",
          enabled: () => true,
          promptVersion: "source-vetting-v1",
        }),
    ).toThrow(TypeError);
  });

  it("holds the 0.9 floor even if a lower threshold is configured", async () => {
    const records: VettingAuditRecord[] = [];
    const decide = vi.fn();
    const service = new AutomatedSourceVetting({
      application: {
        readReviewerCase: async () => trustCase(),
        readReviewerEvidence: async () => ({
          caseId: CASE_ID,
          caseVersion: 3,
          evidence: {
            contributionId: CONTRIBUTION,
            evidenceDigestSha256: DIGEST,
            verifiedAt: "2026-10-22T00:00:00.000Z",
            provider: "ashby",
            sourceUrl: "https://jobs.ashbyhq.com/acme/1",
            title: "t",
            companyName: "c",
            description: "d",
            locations: [],
          },
        }),
        decideInitialReview: decide,
        listReviewerCases: async () => ({ items: [] }),
      } as never,
      assessor: { assess: async () => assessment({ confidence: 0.5 }) },
      audit: { record: async (entry) => void records.push(entry) },
      reviewerId: REVIEWER,
      enabled: () => true,
      promptVersion: "source-vetting-v1",
      minimumConfidence: 0.1,
    });
    await expect(service.vet(CASE_ID)).resolves.toMatchObject({ outcome: "deferred" });
    expect(decide).not.toHaveBeenCalled();
  });
});
