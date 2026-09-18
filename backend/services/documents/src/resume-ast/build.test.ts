import { describe, expect, it } from "vitest";
import { buildResumeAst, classifyHeading, flattenAst, isBulletText } from "./build.js";
import { SYNTHETIC_RESUME, syntheticDocument } from "./test-support.js";

describe("buildResumeAst", () => {
  const ast = buildResumeAst(syntheticDocument(SYNTHETIC_RESUME));

  it("recognizes sections and keeps pre-heading text as contact", () => {
    expect(ast.sections.map((section) => section.kind)).toEqual([
      "contact",
      "summary",
      "experience",
      "education",
      "skills",
    ]);
    expect(ast.sections[0]?.entries[0]?.lines.map((line) => line.text)).toEqual([
      "Alex Example",
      "alex@example.test | Springfield",
    ]);
  });

  it("groups experience into entries with their bullets", () => {
    const experience = ast.sections.find((section) => section.kind === "experience");
    expect(experience?.entries).toHaveLength(2);
    expect(experience?.entries[0]?.lines.map((line) => line.text)).toEqual([
      "Senior Engineer - Acme Corp",
      "2021 - Present",
    ]);
    expect(experience?.entries[0]?.bullets).toHaveLength(2);
    expect(experience?.entries[1]?.bullets.map((bullet) => bullet.text)).toEqual([
      "- Maintained PostgreSQL clusters",
    ]);
  });

  it("maps every source block to exactly one node with an exact span", () => {
    const nodes = flattenAst(ast);
    const document = syntheticDocument(SYNTHETIC_RESUME);
    expect(nodes).toHaveLength(document.blocks.length);
    expect(new Set(nodes.map((node) => node.span.blockIndex)).size).toBe(nodes.length);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    for (const node of nodes) {
      const block = document.blocks[node.span.blockIndex];
      expect(node.text).toBe(block?.text);
      expect(block?.text.slice(node.span.startOffset, node.span.endOffset)).toBe(node.text);
    }
  });

  it("is deterministic and depends only on the immutable document", () => {
    const again = buildResumeAst(syntheticDocument(SYNTHETIC_RESUME));
    expect(again).toEqual(ast);
    const other = buildResumeAst({ ...syntheticDocument(SYNTHETIC_RESUME), version: 2 });
    expect(flattenAst(other)[0]?.id).not.toBe(flattenAst(ast)[0]?.id);
  });

  it("does not turn bullets, long lines, or unknown headings into sections", () => {
    expect(classifyHeading("Experience")).toBe("experience");
    expect(classifyHeading("WORK EXPERIENCE:")).toBe("experience");
    expect(classifyHeading("Technical Skills")).toBe("skills");
    expect(classifyHeading("Interests")).toBeNull();
    expect(classifyHeading(`Experience ${"x".repeat(60)}`)).toBeNull();
    expect(isBulletText("• Experience")).toBe(true);
    const tricky = buildResumeAst(
      syntheticDocument(["Name", "Experience", "• Education", "Interests", "Chess"]),
    );
    expect(tricky.sections.map((section) => section.kind)).toEqual(["contact", "experience"]);
    const experience = tricky.sections[1];
    expect(flattenAst(tricky)).toHaveLength(5);
    expect(experience?.entries.flatMap((entry) => entry.bullets)).toHaveLength(1);
  });

  it("handles empty and heading-only documents without inventing content", () => {
    expect(buildResumeAst(syntheticDocument([])).sections).toEqual([]);
    const headingOnly = buildResumeAst(syntheticDocument(["Skills"]));
    expect(headingOnly.sections).toHaveLength(1);
    expect(headingOnly.sections[0]?.entries).toEqual([]);
  });
});
