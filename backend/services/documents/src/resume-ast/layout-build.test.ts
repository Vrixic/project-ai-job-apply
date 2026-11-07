import { describe, expect, it } from "vitest";
import { buildResumeAst, classifyHeading, flattenAst, isBulletText } from "./build.js";
import { laidOutDocument, type SyntheticLine, syntheticDocument } from "./test-support.js";

const bullet = (text: string, y: number, x = 36): SyntheticLine => ({
  text: `• ${text}`,
  y,
  runs: [
    { x, w: 5, text: "•" },
    { x: x + 18, w: Math.round(text.length * 6), text },
  ],
});
const continuation = (text: string, y: number, x = 54): SyntheticLine => ({ text, y, x });

describe("buildResumeAst with layout", () => {
  it("keeps a bullet together with its wrapped lines (hanging indent)", () => {
    const ast = buildResumeAst(
      laidOutDocument([
        { text: "Projects", y: 100, size: 20 },
        { text: "Liberator - Programmer", y: 130 },
        bullet("Implemented all of the combat systems and weapons", 150),
        continuation("for every player animation.", 165),
        bullet("Worked in a team", 180),
        { text: "Shutdown - Programmer", y: 205 },
        bullet("Implemented a mantle system", 225),
      ]),
    );
    const projects = ast.sections.find((section) => section.kind === "projects");
    expect(projects?.entries).toHaveLength(2);
    const [first, second] = projects?.entries ?? [];
    expect(first?.bullets.map((node) => node.text)).toEqual([
      "• Implemented all of the combat systems and weapons for every player animation.",
      "• Worked in a team",
    ]);
    expect(first?.bullets[0]?.lines).toHaveLength(2);
    expect(first?.bullets[0]?.span).toMatchObject({ blockIndex: 2 });
    expect(first?.bullets[0]?.span.endOffset).toBe(first?.bullets[0]?.text.length);
    expect(second?.lines.map((node) => node.text)).toEqual(["Shutdown - Programmer"]);
  });

  it("keeps every source line exactly once, in order", () => {
    const document = laidOutDocument([
      { text: "Projects", y: 100, size: 20 },
      bullet("First bullet that wraps", 150),
      continuation("onto a second line", 165),
      continuation("and a third line", 180),
    ]);
    const nodes = flattenAst(buildResumeAst(document));
    expect(nodes.flatMap((node) => node.lines ?? [])).toHaveLength(document.blocks.length);
    expect(nodes.map((node) => node.text).join(" ")).toBe(
      document.blocks.map((block) => block.text).join(" "),
    );
  });

  it("does not take a heading or the next entry's title for a continuation", () => {
    const ast = buildResumeAst(
      laidOutDocument([
        { text: "Experience", y: 100, size: 20 },
        bullet("Built a payments API", 130),
        { text: "Education", y: 150, x: 54, size: 20 },
        bullet("Deans list", 180),
      ]),
    );
    expect(ast.sections.map((section) => section.kind)).toEqual(["experience", "education"]);
  });

  it("does not merge across a large vertical gap", () => {
    const ast = buildResumeAst(
      laidOutDocument([
        { text: "Experience", y: 100, size: 20 },
        bullet("Built a payments API", 130),
        continuation("Unrelated paragraph far below", 230),
      ]),
    );
    const entry = ast.sections[0]?.entries.flatMap((item) => item.bullets) ?? [];
    expect(entry).toHaveLength(1);
    expect(entry[0]?.lines).toHaveLength(1);
  });

  it("merges wrapped lines that start at the marker only after a line that ran to the margin", () => {
    const long = "Documented test results on player experience: was the player able to finish";
    const ast = buildResumeAst(
      laidOutDocument([
        { text: "Project", y: 100, size: 20 },
        {
          text: `• ${long}`,
          y: 130,
          runs: [{ x: 54, w: 520, text: `• ${long}` }],
        },
        { text: "had left, what ability was used more", y: 145, x: 54 },
        {
          text: "• Short bullet that ends a sentence.",
          y: 160,
          runs: [{ x: 54, w: 200, text: "• Short bullet that ends a sentence." }],
        },
        { text: "Designed each level for a box layout", y: 175, x: 54 },
      ]),
    );
    const bullets = ast.sections[0]?.entries.flatMap((entry) => entry.bullets) ?? [];
    expect(bullets[0]?.text).toBe(`• ${long} had left, what ability was used more`);
    expect(bullets[0]?.lines).toHaveLength(2);
    // A short line that ended its sentence is not followed into the next, capitalized line.
    expect(bullets[1]?.text).toBe("• Short bullet that ends a sentence.");
  });

  it("records each line's distance from the one before it, and none at the top of a page", () => {
    const document = laidOutDocument([
      { text: "Experience", y: 100, size: 20 },
      bullet("One", 130),
      bullet("Two", 148),
    ]);
    const second = document.blocks[2];
    if (second) second.page = 2;
    const nodes = flattenAst(buildResumeAst(document));
    expect(nodes[1]?.lines?.[0]?.dy).toBe(30);
    expect(nodes[2]?.lines?.[0]?.dy).toBeUndefined();
  });

  it("carries the page size and leaves a document without layout unchanged", () => {
    const withLayout = buildResumeAst(laidOutDocument([{ text: "Experience", y: 100 }]));
    expect(withLayout.page).toEqual({ width: 612, height: 792 });
    const plain = buildResumeAst(
      syntheticDocument(["Experience", "• Wrapped bullet", "continuation line"]),
    );
    expect(plain.page).toBeUndefined();
    expect(flattenAst(plain).every((node) => node.lines === undefined)).toBe(true);
    expect(flattenAst(plain)).toHaveLength(3);
  });
});

describe("section structure", () => {
  it("keeps the source order of a section that mixes lines and bullets", () => {
    const ast = buildResumeAst(
      syntheticDocument(["Summary", "Line A", "• Bullet A", "Line B", "• Bullet B"]),
    );
    const order = ast.sections[0]?.entries.flatMap((entry) => [
      ...entry.lines.map((node) => node.text),
      ...entry.bullets.map((node) => node.text),
    ]);
    expect(order).toEqual(["Line A", "• Bullet A", "Line B", "• Bullet B"]);
  });

  it("recognizes a singular Project heading and a bullet glyph that touches its text", () => {
    expect(classifyHeading("Project")).toBe("projects");
    expect(classifyHeading("Projects")).toBe("projects");
    expect(isBulletText("•Designed the functionality")).toBe(true);
    expect(isBulletText("-Designed")).toBe(false);
    expect(isBulletText("- Designed")).toBe(true);
  });
});

describe("reading zones in the tree", () => {
  it("measures a line's distance from the line before it in its own zone only", () => {
    const document = laidOutDocument([
      { text: "Experience", y: 100, size: 20 },
      bullet("One", 130),
      bullet("Two", 148),
      { text: "Skills", y: 100, size: 20, zone: 1 },
      { text: "C++", y: 130, zone: 1 },
    ]);
    const lines = buildResumeAst(document)
      .sections.flatMap((section) => [
        ...(section.heading ? [section.heading] : []),
        ...section.entries.flatMap((entry) => [...entry.lines, ...entry.bullets]),
      ])
      .flatMap((node) => node.lines ?? []);
    const skills = lines.find((line) => line.zone === 1 && line.y === 100);
    // The first line of the second zone has no distance from the last line of the first.
    expect(skills?.dy).toBeUndefined();
    expect(skills?.zone).toBe(1);
    expect(lines.find((line) => line.zone === 1 && line.y === 130)?.dy).toBe(30);
    expect(lines.find((line) => line.y === 148)?.zone).toBeUndefined();
  });
});
