import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  D1MatchEvaluationRejectedError,
  evaluateD1MatchAssessment,
} from "./match-assessment-evaluation.js";

const evaluationUrl = new URL(
  "../../../../data/evals/matching/d1-match-assessment.v1.json",
  import.meta.url,
);

async function evaluationDocument(): Promise<unknown> {
  return JSON.parse(await readFile(evaluationUrl, "utf8")) as unknown;
}

describe("D1 match-assessment evaluation", () => {
  it("meets every deterministic coverage, safety, and grounding threshold", async () => {
    expect(evaluateD1MatchAssessment(await evaluationDocument())).toEqual({
      caseCount: 36,
      assessmentCount: 34,
      unavailableCount: 2,
      evidenceTupleCount: 306,
      knownConflictCount: 13,
      nonConflictCount: 21,
      falseExclusionCount: 0,
      coveredReasonCodeCount: 15,
      deterministicReplayCount: 36,
      segmentCellCount: 6,
    });
  });

  it.each([
    [
      "approval fabrication",
      (value: Record<string, unknown>) => (value.approvalState = "approved"),
    ],
    [
      "representation expansion",
      (value: Record<string, unknown>) =>
        ((value.representation as Record<string, unknown>).geography = "global"),
    ],
    ["case removal", (value: Record<string, unknown>) => (value.cases as unknown[]).pop()],
    [
      "duplicate case identifier",
      (value: Record<string, unknown>) => {
        const cases = value.cases as Record<string, unknown>[];
        if (cases[0] && cases[1]) cases[1].id = cases[0].id;
      },
    ],
    [
      "duplicate core cell scenario",
      (value: Record<string, unknown>) => {
        const cases = value.cases as Record<string, unknown>[];
        if (cases[1]) cases[1].scenario = "aligned";
      },
    ],
    [
      "unexpected guardrail scenario",
      (value: Record<string, unknown>) => {
        const cases = value.cases as Record<string, unknown>[];
        if (cases[24]) cases[24].scenario = "unreviewed_guardrail";
      },
    ],
    ["unexpected document field", (value: Record<string, unknown>) => (value.extra = true)],
    [
      "unexpected candidate field",
      (value: Record<string, unknown>) =>
        ((
          (value.fixtures as Record<string, unknown>[])[0]?.preferences as Record<string, unknown>
        ).voluntaryDemographic = "synthetic-value"),
    ],
    [
      "expected gate weakening",
      (value: Record<string, unknown>) =>
        (((value.expectations as Record<string, unknown>[])[1] as Record<string, unknown>).gate =
          "review_required"),
    ],
  ])("fails closed on %s", async (_label, mutate) => {
    const value = (await evaluationDocument()) as Record<string, unknown>;
    mutate(value);
    expect(() => evaluateD1MatchAssessment(value)).toThrow(D1MatchEvaluationRejectedError);
  });
});
