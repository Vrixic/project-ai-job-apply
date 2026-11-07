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

export interface SyntheticLine {
  text: string;
  /** Baseline from the top of the page. */
  y: number;
  x?: number;
  size?: number;
  /** Explicit runs; otherwise one run spans the text. */
  runs?: Array<{ x: number; w: number; text: string; bold?: true; color?: string }>;
  rules?: Array<{ x0: number; x1: number; dy: number; h: number }>;
  /** Reading zone of its page, from 1; absent means the first. */
  zone?: number;
}

/** A document whose every line carries layout, as a PDF parsed with PDF.js would. */
export function laidOutDocument(
  lines: readonly SyntheticLine[],
  page = { width: 612, height: 792 },
): NormalizedResumeDocument {
  const base = syntheticDocument(lines.map((line) => line.text));
  return {
    ...base,
    page,
    blocks: base.blocks.map((block, index) => {
      const line = lines[index] as SyntheticLine;
      const size = line.size ?? 12;
      const x = line.x ?? 36;
      return {
        ...block,
        page: 1,
        layout: {
          y: line.y,
          runs: (
            line.runs ?? [{ x, w: Math.round(line.text.length * size * 0.5), text: line.text }]
          ).map((run) => ({ ...run, size })),
          ...(line.rules ? { rules: line.rules } : {}),
          ...(line.zone === undefined ? {} : { zone: line.zone }),
        },
      };
    }),
  };
}
