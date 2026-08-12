import { describe, expect, it } from "vitest";
import { extractResumeFactProposals } from "./proposals.js";
import type { NormalizedResumeDocument } from "./parsing/index.js";

const document: NormalizedResumeDocument = {
  documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
  version: 1,
  parserVersion: "resume-parser-v1",
  mediaType: "application/pdf",
  sourceSha256: "a".repeat(64),
  createdAt: "2026-08-12T12:00:00.000Z",
  blocks: [
    {
      index: 0,
      text: "Taylor Candidate · taylor@example.test",
      startOffset: 0,
      endOffset: 38,
      page: 1,
    },
    {
      index: 1,
      text: "Skills: TypeScript, PostgreSQL, visa sponsorship",
      startOffset: 39,
      endOffset: 89,
      page: 1,
    },
  ],
};

describe("resume fact proposals", () => {
  it("creates only conservative proposed inputs with exact value-free locators", () => {
    const proposals = extractResumeFactProposals(document);
    expect(proposals.map(({ kind, key, value }) => ({ kind, key, value }))).toEqual([
      { kind: "identity", key: "email", value: "taylor@example.test" },
      { kind: "skill", key: "skill", value: "TypeScript" },
      { kind: "skill", key: "skill", value: "PostgreSQL" },
    ]);
    expect(JSON.stringify(proposals[0]?.evidence)).not.toContain("taylor@example.test");
    expect(proposals[1]?.evidence.supportingSpans[0]).toMatchObject({
      documentId: document.documentId,
      blockIndex: 1,
      startOffset: 8,
      endOffset: 18,
    });
  });
});
