import { describe, expect, it } from "vitest";
import { type ResumePreviewBody, withPacketMatch } from "./resume-preview.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ready: ResumePreviewBody = {
  status: "ready",
  baseDocument: { id: "019d04cf-1f80-7000-8000-000000000001", fileName: "resume.pdf" },
  tailoringVersion: "tailoring.v1",
  contentSha256: HASH_A,
  matchedTerms: ["typescript"],
  sections: [],
};

describe("withPacketMatch", () => {
  it("is true only when the packet carries exactly this tailored resume", () => {
    expect(withPacketMatch(ready, HASH_A).matchesPacket).toBe(true);
  });

  it("is false when the resume, job text, or tailoring version changed since preparation", () => {
    expect(withPacketMatch(ready, HASH_B).matchesPacket).toBe(false);
  });

  it("is false when the packet has no resume or no packet exists", () => {
    expect(withPacketMatch(ready, undefined).matchesPacket).toBe(false);
  });

  it("is false when there is nothing to match, whatever the packet says", () => {
    expect(withPacketMatch({ status: "no_resume" }, HASH_A).matchesPacket).toBe(false);
    expect(
      withPacketMatch({ status: "unavailable", unavailableReason: "render_failed" }, HASH_A)
        .matchesPacket,
    ).toBe(false);
  });
});
