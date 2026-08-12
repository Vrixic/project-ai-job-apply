import type { ProfileFact, ResumeDocument } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import { partitionProfileFacts } from "./profile-facts-form";
import { ResumePollingTargets, recoverableResumeIds } from "./resume-upload-form";

const baseFact: ProfileFact = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
  kind: "skill",
  key: "skill",
  value: "TypeScript",
  verification: "proposed",
  sensitivity: "standard",
  source: { type: "resume", reference: "resume:opaque" },
  evidence: {
    supportingSpans: [
      {
        documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        documentVersion: 1,
        parserVersion: "resume-parser-v1",
        blockIndex: 0,
        startOffset: 0,
        endOffset: 10,
      },
    ],
  },
  version: 1,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
};

describe("resume proposal presentation state", () => {
  it("keeps system-invalidated facts outside candidate review lists", () => {
    const invalidated: ProfileFact = {
      ...baseFact,
      verification: "confirmed",
      availability: { state: "invalidated", reasonCode: "source_security_hold" },
    };
    expect(partitionProfileFacts([baseFact, invalidated])).toEqual({
      proposed: [baseFact],
      reviewed: [],
      invalidated: [invalidated],
    });
  });

  it("recovers only active or recent upload registrations after navigation", () => {
    const now = Date.parse("2026-08-12T12:20:00.000Z");
    const document = (id: string, status: ResumeDocument["status"], createdAt: string) =>
      ({ id, status, createdAt }) as ResumeDocument;
    expect(
      recoverableResumeIds(
        [
          document("recent", "awaiting_upload", "2026-08-12T12:10:00.000Z"),
          document("abandoned", "awaiting_upload", "2026-08-12T11:00:00.000Z"),
          document("scanning", "scanning", "2026-08-12T11:00:00.000Z"),
          document("parsed", "parsed", "2026-08-12T12:19:00.000Z"),
        ],
        now,
      ),
    ).toEqual(["recent", "scanning"]);
  });

  it("preserves a target added after the active polling round began", () => {
    const targets = new ResumePollingTargets();
    targets.add(["first"]);
    const activeRound = targets.beginRound();
    targets.add(["overlap"]);
    targets.expire(activeRound);
    expect(targets.pending).toBe(true);
    expect(targets.beginRound()).toEqual(new Set(["overlap"]));
  });
});
