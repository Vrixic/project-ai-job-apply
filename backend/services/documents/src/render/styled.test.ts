import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseResume } from "../parsing/index.js";
import { buildResumeAst } from "../resume-ast/build.js";
import { laidOutDocument, type SyntheticLine } from "../resume-ast/test-support.js";
import { materializeTailoredResume, tailorResume } from "../tailoring/tailor.js";
import { RenderError, renderPdf } from "./render.js";
import { canRenderStyled, hasSourceLines } from "./styled.js";
import { verifyRenderedResume } from "./verify.js";

const RED = "#cc0000";
const bullet = (text: string, y: number): SyntheticLine => ({
  text: `• ${text}`,
  y,
  runs: [
    { x: 36, w: 5, text: "•" },
    { x: 54, w: Math.round(text.length * 5.2), text },
  ],
});

const lines: SyntheticLine[] = [
  {
    text: "Alex Example",
    y: 50,
    x: 200,
    size: 24,
    runs: [{ x: 200, w: 160, text: "Alex Example", bold: true }],
  },
  {
    text: "Projects",
    y: 100,
    size: 18,
    runs: [{ x: 36, w: 80, text: "Projects", color: RED }],
    rules: [{ x0: 36, x1: 576, dy: 6, h: 0.8 }],
  },
  { text: "Liberator - Programmer", y: 130 },
  bullet("Wrote tools for the art team", 150),
  bullet("Built a Vulkan renderer with shader reloading", 168),
  { text: "continues on a second line about rendering", y: 182, x: 54 },
  bullet("Mentored two engineers", 200),
];

function build(job: { title: string; description: string }, maxBulletsPerEntry?: number) {
  const document = laidOutDocument(lines);
  const ast = buildResumeAst(document);
  const tailored = tailorResume(ast, job, maxBulletsPerEntry ? { maxBulletsPerEntry } : {});
  return { ast, blocks: materializeTailoredResume(ast, tailored) };
}

async function reparse(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return parseResume({
    documentId: "019d04cf-1f80-7000-8000-000000000001",
    documentVersion: 1,
    parserVersion: "render-roundtrip",
    mediaType: "application/pdf",
    sourceSha256: createHash("sha256").update(copy).digest("hex"),
    createdAt: "2026-01-01T00:00:00.000Z",
    bytes: copy,
  });
}

describe("styled PDF rendering", () => {
  const job = { title: "Graphics Engineer", description: "Vulkan renderer shader graphics" };

  it("draws the tailored resume in the source's page size and verifies against its text", async () => {
    const { ast, blocks } = build(job);
    expect(blocks.every((block) => block.lines !== undefined)).toBe(true);
    const rendered = renderPdf(blocks, ast.page);
    expect(Buffer.from(rendered.bytes.subarray(0, 8)).toString("latin1")).toMatch(/^%PDF-1\.4/u);
    expect(rendered.pageCount).toBe(1);
    expect(await verifyRenderedResume(rendered, blocks)).toMatchObject({ ok: true, issues: [] });
    const parsed = await reparse(rendered.bytes);
    expect(parsed.page).toEqual({ width: 612, height: 792 });
  });

  it("keeps each kept line's left edge, size, weight, color and rule", async () => {
    const { ast, blocks } = build(job);
    const parsed = await reparse(renderPdf(blocks, ast.page).bytes);
    const byText = (text: string) => parsed.blocks.find((block) => block.text.includes(text));
    const title = byText("Alex Example")?.layout;
    expect(title?.runs[0]).toMatchObject({ x: 200, size: 24, bold: true });
    expect(title?.y).toBeCloseTo(50, 0);
    const heading = byText("Projects")?.layout;
    expect(heading?.runs[0]).toMatchObject({ x: 36, size: 18, color: RED });
    expect(heading?.rules?.[0]).toMatchObject({ x0: 36, x1: 576 });
    expect(heading?.rules?.[0]?.dy).toBeCloseTo(6, 0);
    const wrapped = byText("continues on a second line")?.layout;
    expect(wrapped?.runs[0]?.x).toBeCloseTo(54, 0);
  });

  it("moves a more relevant bullet up and keeps its wrapped line with it", async () => {
    const { ast, blocks } = build(job);
    expect(blocks.filter((block) => block.kind === "bullet").map((block) => block.text)).toEqual([
      "• Built a Vulkan renderer with shader reloading continues on a second line about rendering",
      "• Wrote tools for the art team",
      "• Mentored two engineers",
    ]);
    const parsed = await reparse(renderPdf(blocks, ast.page).bytes);
    const texts = parsed.blocks.map((block) => block.text);
    const vulkan = texts.findIndex((text) => text.includes("Vulkan renderer"));
    expect(texts[vulkan + 1]).toContain("continues on a second line");
    expect(vulkan).toBeLessThan(texts.findIndex((text) => text.includes("Wrote tools")));
    // It follows the title line with the spacing it had after the line before it in the source (18),
    // and its wrapped line keeps the source's 14-point line spacing below it.
    expect(parsed.blocks[vulkan]?.layout?.y).toBeCloseTo(148, 0);
    expect(parsed.blocks[vulkan + 1]?.layout?.y).toBeCloseTo(162, 0);
  });

  it("closes up the space of a bullet that is left out", async () => {
    const { ast, blocks } = build(job, 1);
    const rendered = renderPdf(blocks, ast.page);
    expect(await verifyRenderedResume(rendered, blocks)).toMatchObject({ ok: true });
    const parsed = await reparse(rendered.bytes);
    const texts = parsed.blocks.map((block) => block.text);
    expect(texts.some((text) => text.includes("Mentored"))).toBe(false);
    expect(texts.some((text) => text.includes("Wrote tools"))).toBe(false);
    expect(texts.at(-1)).toContain("continues on a second line");
  });

  it("stretches text to the width it had, within limits", () => {
    const { ast, blocks } = build(job);
    const pdf = Buffer.from(renderPdf(blocks, ast.page).bytes).toString("latin1");
    const stretches = [...pdf.matchAll(/ ([\d.]+) Tz /gu)].map((match) => Number(match[1]));
    expect(stretches.length).toBeGreaterThan(5);
    for (const value of stretches) {
      expect(value).toBeGreaterThanOrEqual(70);
      expect(value).toBeLessThanOrEqual(130);
    }
  });

  it("falls back to plain text for blocks without layout", () => {
    const { blocks } = build(job);
    const plain = blocks.map(({ lines: _lines, ...rest }) => rest);
    expect(renderPdf(plain, { width: 612, height: 792 }).pageCount).toBe(1);
    const pdf = Buffer.from(renderPdf(plain).bytes).toString("latin1");
    expect(pdf).not.toContain(" Tz ");
  });

  it("refuses a character the standard fonts cannot draw rather than substituting one", () => {
    const { ast, blocks } = build(job);
    const first = blocks[0]?.lines?.[0]?.runs[0];
    if (first) first.text = "Alex 中";
    expect(() => renderPdf(blocks, ast.page)).toThrow(RenderError);
  });

  it("starts another page when the lines no longer fit", () => {
    const { ast, blocks } = build(job);
    // Stretch the spacing of every line so the same content needs more than the page allows.
    for (const block of blocks) for (const line of block.lines ?? []) if (line.dy) line.dy *= 12;
    expect(renderPdf(blocks, ast.page).pageCount).toBeGreaterThan(1);
  });
});

describe("pages with reading zones", () => {
  it("are not redrawn from layout, only edited in place", () => {
    const document = laidOutDocument([
      { text: "Projects", y: 100, size: 18 },
      bullet("Built a renderer", 130),
      { text: "Skills", y: 100, size: 18, zone: 1 },
    ]);
    const ast = buildResumeAst(document);
    const blocks = materializeTailoredResume(
      ast,
      tailorResume(ast, { title: "x", description: "y" }),
    );
    expect(canRenderStyled(blocks, ast.page)).toBe(false);
    expect(hasSourceLines(blocks)).toBe(true);
  });
});
