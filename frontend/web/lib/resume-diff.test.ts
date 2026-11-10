import { describe, expect, it } from "vitest";
import { linesFromTextItems, type PdfTextItem } from "./pdf-text-lines";
import { diffResumeLines, lineKey, type TextLine, wordChanges } from "./resume-diff";

const line = (text: string, top = 0, page = 1): TextLine => ({
  page,
  x: 36,
  top,
  width: 200,
  height: 12,
  text,
});
const lines = (...texts: string[]) => texts.map((text, index) => line(text, index * 14));

describe("diffResumeLines", () => {
  it("keeps an unchanged resume entirely", () => {
    const diff = diffResumeLines(
      lines("A one", "B two", "C three"),
      lines("A one", "B two", "C three"),
    );
    expect(diff.counts).toEqual({ kept: 3, moved: 0, changed: 0, removed: 0, added: 0 });
    expect(diff.original.map((entry) => entry.pair)).toEqual([0, 1, 2]);
  });

  it("marks dropped lines as removed and everything else as kept when only lines are dropped", () => {
    const diff = diffResumeLines(
      lines("Header", "Job one", "Bullet a", "Bullet b", "Job two"),
      lines("Header", "Job one", "Bullet b", "Job two"),
    );
    expect(diff.original.map((entry) => entry.status)).toEqual([
      "kept",
      "kept",
      "removed",
      "kept",
      "kept",
    ]);
    expect(diff.counts).toEqual({ kept: 4, moved: 0, changed: 0, removed: 1, added: 0 });
    expect(diff.tailored.every((entry) => entry.status === "kept")).toBe(true);
  });

  it("marks a reordered block as moved, on both sides", () => {
    const diff = diffResumeLines(
      lines("Summary", "Skills", "Experience"),
      lines("Experience", "Summary", "Skills"),
    );
    expect(diff.counts.removed).toBe(0);
    expect(diff.counts.added).toBe(0);
    expect(diff.counts.moved).toBe(1);
    expect(diff.counts.kept).toBe(2);
    const moved = diff.original.findIndex((entry) => entry.status === "moved");
    expect(diff.original[moved]?.line.text).toBe("Experience");
    expect(diff.tailored[diff.original[moved]?.pair ?? -1]?.status).toBe("moved");
  });

  it("marks an edited line as changed and says which words changed", () => {
    const diff = diffResumeLines(
      lines("Built a Vulkan renderer with shader reloading"),
      lines("Built a Vulkan renderer with hot shader reloading and profiling"),
    );
    expect(diff.original[0]?.status).toBe("changed");
    expect(diff.tailored[0]?.status).toBe("changed");
    const words = diff.tailored[0]?.words ?? [];
    expect(words.filter((word) => word.kind === "added").map((word) => word.text)).toEqual([
      "hot",
      "and",
      "profiling",
    ]);
    expect(words.filter((word) => word.kind === "removed")).toEqual([]);
    expect(diff.counts).toEqual({ kept: 0, moved: 0, changed: 1, removed: 0, added: 0 });
  });

  it("marks text that is only in the tailored resume as added", () => {
    const diff = diffResumeLines(
      lines("A one"),
      lines("A one", "Entirely new sentence about something else"),
    );
    expect(diff.tailored.map((entry) => entry.status)).toEqual(["kept", "added"]);
    expect(diff.counts.added).toBe(1);
  });

  it("does not turn short unrelated lines into an edit", () => {
    const diff = diffResumeLines(lines("Remote"), lines("Austin"));
    expect(diff.original[0]?.status).toBe("removed");
    expect(diff.tailored[0]?.status).toBe("added");
  });

  it("treats repeated identical lines by multiplicity", () => {
    const diff = diffResumeLines(lines("Same", "Other", "Same"), lines("Other", "Same"));
    expect(diff.counts.removed).toBe(1);
    expect(diff.counts.kept).toBe(2);
  });

  it("ignores spacing differences and empty lines", () => {
    const diff = diffResumeLines(lines("A   one ", "", "B two"), lines("A one", "B   two"));
    expect(diff.counts).toEqual({ kept: 2, moved: 0, changed: 0, removed: 0, added: 0 });
    expect(diff.original).toHaveLength(2);
  });

  it("accounts for every line exactly once", () => {
    const diff = diffResumeLines(
      lines("a1 a2 a3", "b1 b2 b3", "c1 c2 c3", "d1 d2 d3 d4", "e1"),
      lines("c1 c2 c3", "a1 a2 a3 a4", "x1 x2", "e1"),
    );
    const { kept, moved, changed, removed, added } = diff.counts;
    expect(kept + moved + changed + removed).toBe(diff.original.length);
    expect(kept + moved + changed + added).toBe(diff.tailored.length);
  });
});

describe("wordChanges", () => {
  it("reports removed and added words around the words that stay", () => {
    expect(wordChanges("one two three", "one 2 three four").map((change) => change.kind)).toEqual([
      "same",
      "removed",
      "added",
      "same",
      "added",
    ]);
  });
});

describe("lineKey", () => {
  it("collapses whitespace", () => {
    expect(lineKey("  a \n b\t c ")).toBe("a b c");
  });
});

function item(str: string, x: number, y: number, width = str.length * 5, height = 10): PdfTextItem {
  return { str, transform: [height, 0, 0, height, x, y], width, height };
}

describe("linesFromTextItems", () => {
  it("joins the words on one baseline into one line, top of the page first", () => {
    const result = linesFromTextItems(
      [item("World", 66, 700), item("Hello", 36, 700), item("Second", 36, 686)],
      1,
      792,
    );
    expect(result.map((entry) => entry.text)).toEqual(["Hello World", "Second"]);
    expect(result[0]?.top).toBeLessThan(result[1]?.top ?? 0);
  });

  it("does not add a space inside a word that was split into styled runs", () => {
    const result = linesFromTextItems(
      [item("Pro", 36, 700, 15), item("gramming", 51, 700, 40)],
      1,
      792,
    );
    expect(result.map((entry) => entry.text)).toEqual(["Programming"]);
  });

  it("keeps a space the file already has", () => {
    const result = linesFromTextItems(
      [item("Pro ", 36, 700, 20), item("gramming", 56, 700, 40)],
      1,
      792,
    );
    expect(result[0]?.text).toBe("Pro gramming");
  });

  it("starts a new line for text far to the right on the same baseline", () => {
    const result = linesFromTextItems(
      [item("Company", 36, 700), item("2019 - 2021", 500, 700)],
      1,
      792,
    );
    expect(result.map((entry) => entry.text)).toEqual(["Company", "2019 - 2021"]);
  });

  it("drops whitespace-only items", () => {
    expect(linesFromTextItems([item(" ", 36, 700), item("Text", 40, 700)], 1, 792)).toHaveLength(1);
  });
});
