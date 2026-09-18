import type { NormalizedResumeDocument } from "../parsing/normalize.js";

export function syntheticDocument(lines: readonly string[]): NormalizedResumeDocument {
  let offset = 0;
  return {
    documentId: "019d04cf-1f80-7000-8000-000000000001",
    version: 1,
    parserVersion: "synthetic-parser-1",
    mediaType: "application/pdf",
    sourceSha256: "a".repeat(64),
    blocks: lines.map((text, index) => {
      const startOffset = offset;
      offset += text.length + 1;
      return { index, text, startOffset, endOffset: startOffset + text.length };
    }),
    createdAt: "2026-09-18T12:00:00.000Z",
  };
}

export const SYNTHETIC_RESUME = [
  "Alex Example",
  "alex@example.test | Springfield",
  "Summary",
  "Backend engineer focused on reliable services.",
  "Experience",
  "Senior Engineer - Acme Corp",
  "2021 - Present",
  "• Built a payments API in TypeScript serving 40 partners",
  "• Reduced deploy time from 30 to 6 minutes",
  "Engineer - Globex",
  "2018 - 2021",
  "- Maintained PostgreSQL clusters",
  "Education",
  "BS Computer Science - Example University",
  "Skills",
  "TypeScript, PostgreSQL, Kubernetes",
] as const;
