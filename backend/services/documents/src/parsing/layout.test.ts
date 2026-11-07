import { describe, expect, it } from "vitest";
import { laidOutDocument } from "../resume-ast/test-support.js";
import { InvalidDocumentError } from "./limits.js";
import { normalizeBlocks, parseNormalizedResumeDocument } from "./normalize.js";

const document = () =>
  laidOutDocument([
    { text: "Alex Example", y: 50, size: 26 },
    { text: "Experience", y: 100, size: 20, rules: [{ x0: 36, x1: 576, dy: 6, h: 0.7 }] },
  ]);

describe("layout of a normalized document", () => {
  it("accepts a document whose every block carries a layout and a page size", () => {
    const parsed = parseNormalizedResumeDocument(structuredClone(document()));
    expect(parsed.page).toEqual({ width: 612, height: 792 });
    expect(parsed.blocks[1]?.layout?.rules).toEqual([{ x0: 36, x1: 576, dy: 6, h: 0.7 }]);
  });

  it("still accepts a document with no layout at all", () => {
    const plain = structuredClone(document());
    delete plain.page;
    for (const block of plain.blocks) delete block.layout;
    expect(parseNormalizedResumeDocument(plain).blocks).toHaveLength(2);
  });

  it.each([
    [
      "a layout on only some blocks",
      (value: ReturnType<typeof document>) => delete value.blocks[1]?.layout,
    ],
    ["layouts without a page size", (value: ReturnType<typeof document>) => delete value.page],
    [
      "a color that is not #rrggbb",
      (value: ReturnType<typeof document>) => {
        const run = value.blocks[0]?.layout?.runs[0];
        if (run) run.color = "red";
      },
    ],
    [
      "an unknown run property",
      (value: ReturnType<typeof document>) => {
        const run = value.blocks[0]?.layout?.runs[0] as unknown as Record<string, unknown>;
        run.script = "alert(1)";
      },
    ],
    [
      "a run with a non-finite position",
      (value: ReturnType<typeof document>) => {
        const run = value.blocks[0]?.layout?.runs[0];
        if (run) run.x = Number.POSITIVE_INFINITY;
      },
    ],
    [
      "an absurd font size",
      (value: ReturnType<typeof document>) => {
        const run = value.blocks[0]?.layout?.runs[0];
        if (run) run.size = 5000;
      },
    ],
    [
      "run text longer than its block",
      (value: ReturnType<typeof document>) => {
        const run = value.blocks[0]?.layout?.runs[0];
        if (run) run.text = "x".repeat(500);
      },
    ],
  ])("refuses %s", (_name, damage) => {
    const value = structuredClone(document());
    damage(value);
    expect(() => parseNormalizedResumeDocument(value)).toThrow(InvalidDocumentError);
  });

  it("drops every layout when any non-empty line lacks one", () => {
    const blocks = normalizeBlocks([
      { text: "Alex", layout: { y: 10, runs: [{ x: 1, w: 20, size: 12, text: "Alex" }] } },
      { text: "Experience" },
    ]);
    expect(blocks.every((block) => block.layout === undefined)).toBe(true);
  });

  it("keeps layouts when only blank lines lack one", () => {
    const blocks = normalizeBlocks([
      { text: "Alex", layout: { y: 10, runs: [{ x: 1, w: 20, size: 12, text: "Alex" }] } },
      { text: "   " },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.layout?.y).toBe(10);
  });
});

describe("reading zones in a layout", () => {
  const withZone = (zone: unknown) => {
    const value = structuredClone(document());
    const layout = value.blocks[1]?.layout as Record<string, unknown> | undefined;
    if (layout) layout.zone = zone;
    return value;
  };

  it.each([1, 2, 32])("accepts zone %s", (zone) => {
    expect(parseNormalizedResumeDocument(withZone(zone)).blocks[1]?.layout?.zone).toBe(zone);
  });

  it.each([0, -1, 33, 1.5, "1", null])("refuses zone %s", (zone) => {
    expect(() => parseNormalizedResumeDocument(withZone(zone))).toThrow(InvalidDocumentError);
  });
});
