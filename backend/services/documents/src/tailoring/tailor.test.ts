import { describe, expect, it } from "vitest";
import { buildResumeAst, flattenAst } from "../resume-ast/build.js";
import { SYNTHETIC_RESUME, syntheticDocument } from "../resume-ast/test-support.js";
import {
  describeDiff,
  extractTerms,
  materializeTailoredResume,
  tailorResume,
  verifyTailoredFactuality,
} from "./tailor.js";

const ast = buildResumeAst(syntheticDocument(SYNTHETIC_RESUME));
const job = {
  title: "Senior Backend Engineer",
  description:
    "Build reliable payments APIs in TypeScript with PostgreSQL. Reduce deploy time and improve delivery.",
};

describe("term extraction", () => {
  it("keeps technical tokens, drops stop words and bare numbers", () => {
    const terms = extractTerms(
      "We use C++, Node.js, C# and PostgreSQL for 24 services in the team",
    );
    expect(terms).toEqual(
      expect.arrayContaining(["c++", "node.js", "c#", "postgresql", "services"]),
    );
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("24");
  });
});

describe("tailorResume", () => {
  it("orders bullets by job overlap and reports only terms the candidate already has", () => {
    const tailored = tailorResume(ast, job);
    const experience = tailored.sections.find((section) => section.kind === "experience");
    const firstEntry = experience?.entries[0];
    const base = ast.sections.find((section) => section.kind === "experience")?.entries[0];
    // The payments/TypeScript bullet outranks the deploy-time bullet only if it overlaps more.
    expect(firstEntry?.bulletNodeIds).toHaveLength(2);
    expect(new Set(firstEntry?.bulletNodeIds)).toEqual(new Set(base?.bullets.map((b) => b.id)));
    expect(tailored.matchedTerms).toEqual(
      expect.arrayContaining(["typescript", "deploy", "time", "payments"]),
    );
    // A job term the candidate never wrote is never claimed as matched.
    expect(tailored.matchedTerms).not.toContain("reliable");
    expect(tailored.matchedTerms).not.toContain("kubernetes");
  });

  it("omits the least relevant bullets past the cap and records the reason", () => {
    const capped = tailorResume(ast, job, { maxBulletsPerEntry: 1 });
    const experience = capped.sections.find((section) => section.kind === "experience");
    expect(experience?.entries[0]?.bulletNodeIds).toHaveLength(1);
    const omitted = capped.diff.filter((entry) => entry.op === "omit");
    expect(omitted).toHaveLength(1);
    expect(omitted[0]).toMatchObject({ reason: "lower_relevance" });
  });

  it("never edits, drops, or reorders sections, entries, headings, or non-tailorable content", () => {
    const tailored = tailorResume(ast, job, { maxBulletsPerEntry: 1 });
    expect(tailored.sections.map((section) => section.sectionId)).toEqual(
      ast.sections.map((section) => section.id),
    );
    for (const [index, section] of tailored.sections.entries()) {
      const base = ast.sections[index];
      expect(section.entries.map((entry) => entry.entryId)).toEqual(
        base?.entries.map((entry) => entry.id),
      );
      expect(section.entries.map((entry) => entry.lineNodeIds)).toEqual(
        base?.entries.map((entry) => entry.lines.map((line) => line.id)),
      );
      if (section.kind !== "experience" && section.kind !== "projects") {
        expect(section.entries.map((entry) => entry.bulletNodeIds)).toEqual(
          base?.entries.map((entry) => entry.bullets.map((bullet) => bullet.id)),
        );
      }
    }
  });

  it("is deterministic and every output text is a verbatim base node", () => {
    const first = tailorResume(ast, job);
    expect(tailorResume(ast, job)).toEqual(first);
    const baseTexts = new Set(flattenAst(ast).map((node) => node.text));
    const blocks = materializeTailoredResume(ast, first);
    for (const block of blocks) expect(baseTexts.has(block.text)).toBe(true);
    expect(verifyTailoredFactuality(ast, first)).toEqual([]);
  });

  it("describes a visible diff with fixed reasons and no invented text", () => {
    const diff = describeDiff(ast, tailorResume(ast, job, { maxBulletsPerEntry: 1 }));
    const baseTexts = new Set(flattenAst(ast).map((node) => node.text));
    expect(diff.every((line) => baseTexts.has(line.text))).toBe(true);
    expect(diff.some((line) => line.op === "omit" && line.reason === "lower_relevance")).toBe(true);
  });
});

describe("verifyTailoredFactuality", () => {
  const tailored = tailorResume(ast, job);
  const experience = () => tailored.sections.findIndex((section) => section.kind === "experience");

  it("rejects a bullet moved to a different employer entry", () => {
    const copy = structuredClone(tailored);
    const sections = copy.sections[experience()];
    const stolen = sections?.entries[1]?.bulletNodeIds[0] ?? "";
    sections?.entries[0]?.bulletNodeIds.push(stolen);
    const issues = verifyTailoredFactuality(ast, copy);
    expect(issues.map((issue) => issue.code)).toContain("node_in_wrong_entry");
  });

  it("rejects duplicated nodes, unknown ids, unknown entries, and a different base", () => {
    const duplicated = structuredClone(tailored);
    const entry = duplicated.sections[experience()]?.entries[0];
    entry?.bulletNodeIds.push(entry.bulletNodeIds[0] ?? "");
    expect(verifyTailoredFactuality(ast, duplicated).map((i) => i.code)).toContain(
      "duplicate_node",
    );

    const unknown = structuredClone(tailored);
    unknown.sections[experience()]?.entries[0]?.bulletNodeIds.push("n_forged");
    expect(verifyTailoredFactuality(ast, unknown).map((i) => i.code)).toContain(
      "node_in_wrong_entry",
    );

    const forgedEntry = structuredClone(tailored);
    forgedEntry.sections[experience()]?.entries.push({
      entryId: "e_forged",
      lineNodeIds: [],
      bulletNodeIds: [],
    });
    expect(verifyTailoredFactuality(ast, forgedEntry).map((i) => i.code)).toContain(
      "unknown_entry",
    );

    const otherBase = structuredClone(tailored);
    otherBase.base.sourceSha256 = "f".repeat(64);
    expect(verifyTailoredFactuality(ast, otherBase).map((i) => i.code)).toContain("base_mismatch");
  });
});
