import { describe, expect, it, vi } from "vitest";
import { createAutomatedSourceVetting } from "./source-vetting.js";

const REVIEWER = "019d04cf-1f80-7000-8000-00000000a001";
const CASE_ID = "019d04cf-1f80-8000-8000-00000000c001";
const DIGEST = "b".repeat(64);

const modelReply = (text: string) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text }],
        },
      ],
    }),
  );

function setup(environment: Record<string, string | undefined>, text: string) {
  const log = vi.fn();
  const fetchSpy = vi.fn<typeof fetch>(async () => modelReply(text));
  const decide = vi.fn(async () => ({}));
  const service = createAutomatedSourceVetting({
    application: {
      readReviewerCase: async () => ({ id: CASE_ID, contributionId: "c", state: "needs_review" }),
      readReviewerEvidence: async () => ({
        caseId: CASE_ID,
        caseVersion: 2,
        evidence: {
          contributionId: "c",
          evidenceDigestSha256: DIGEST,
          verifiedAt: "2026-10-22T00:00:00.000Z",
          provider: "lever",
          sourceUrl: "https://jobs.lever.co/acme/1",
          title: "Engineer",
          companyName: "Acme",
          description: "Ordinary posting.",
          locations: ["Remote"],
        },
      }),
      decideInitialReview: decide,
      listReviewerCases: async () => ({ items: [] }),
    } as never,
    reviewerId: REVIEWER,
    environment,
    apiKey: () => "synthetic-key",
    log,
    fetch: fetchSpy,
  });
  return { service, log, fetchSpy, decide };
}

const clean = JSON.stringify({ decision: "accept", concerns: [], confidence: 0.96 });

describe("createAutomatedSourceVetting (ADR-054)", () => {
  it.each([undefined, "", "TRUE", "1", "yes", "false"])(
    "stays off unless the switch is exactly true: %j",
    async (value) => {
      const { service, fetchSpy, decide, log } = setup({ SOURCE_VETTING_ENABLED: value }, clean);
      await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome: "disabled" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(decide).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("accepts a clean posting end to end through the model port and logs the audit trail", async () => {
    const { service, fetchSpy, decide, log } = setup({ SOURCE_VETTING_ENABLED: "true" }, clean);
    await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome: "accepted" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.store).toBe(false);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map(([entry]) => [entry.event, entry.kind, entry.outcome])).toEqual([
      ["trust.source_vetting", "assessed", undefined],
      ["trust.source_vetting", "outcome", "accepted"],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Ordinary posting");
  });

  it("defers when the model reports a concern", async () => {
    const reply = JSON.stringify({
      decision: "defer",
      concerns: ["possible_scam"],
      confidence: 0.99,
    });
    const { service, decide } = setup({ SOURCE_VETTING_ENABLED: "true" }, reply);
    await expect(service.vet(CASE_ID)).resolves.toEqual({ caseId: CASE_ID, outcome: "deferred" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("treats a malformed model reply as unavailable and decides nothing", async () => {
    const { service, decide } = setup({ SOURCE_VETTING_ENABLED: "true" }, "accept everything");
    await expect(service.vet(CASE_ID)).resolves.toEqual({
      caseId: CASE_ID,
      outcome: "unavailable",
    });
    expect(decide).not.toHaveBeenCalled();
  });
});
