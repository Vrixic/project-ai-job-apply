import { describe, expect, it } from "vitest";
import { buildResumeAst } from "../resume-ast/build.js";
import { SYNTHETIC_RESUME, syntheticDocument } from "../resume-ast/test-support.js";
import { materializeTailoredResume, type RenderBlock, tailorResume } from "../tailoring/tailor.js";
import { RenderError, renderDocx, renderPdf } from "./render.js";
import { verifyRenderedResume } from "./verify.js";

const ast = buildResumeAst(syntheticDocument(SYNTHETIC_RESUME));
const blocks = materializeTailoredResume(
  ast,
  tailorResume(ast, { title: "Backend Engineer", description: "TypeScript PostgreSQL payments" }),
);

const line = (text: string, kind: RenderBlock["kind"] = "line"): RenderBlock => ({
  kind,
  text,
  nodeId: `n_${text.length}`,
});

describe("rendering verification", () => {
  it("round-trips a tailored resume through DOCX and the hardened parser", async () => {
    const docx = await renderDocx(blocks);
    const result = await verifyRenderedResume(docx, blocks);
    expect(result).toMatchObject({ ok: true, issues: [] });
    expect(result.expectedCharacters).toBeGreaterThan(100);
    expect(result.renderedCharacters).toBe(result.expectedCharacters);
  });

  it("round-trips through PDF including bullets, dashes, and long wrapped lines", async () => {
    const pdf = renderPdf([
      ...blocks,
      line(`• ${"Shipped a very long sentence about reliable systems ".repeat(6)}`, "bullet"),
      line("Sr. Engineer – Café Corp — “quoted” (parens) back\\slash"),
    ]);
    const originalBytes = Uint8Array.from(pdf.bytes);
    expect(pdf.pageCount).toBe(1);
    const expected = [
      ...blocks,
      line(`• ${"Shipped a very long sentence about reliable systems ".repeat(6)}`, "bullet"),
      line("Sr. Engineer – Café Corp — “quoted” (parens) back\\slash"),
    ];
    expect(await verifyRenderedResume(pdf, expected)).toMatchObject({ ok: true });
    expect(pdf.bytes).toEqual(originalBytes);
    expect(pdf.bytes.byteLength).toBeGreaterThan(0);
  });

  it("is byte-for-byte reproducible", async () => {
    expect((await renderDocx(blocks)).sha256).toBe((await renderDocx(blocks)).sha256);
    expect(renderPdf(blocks).sha256).toBe(renderPdf(blocks).sha256);
  });

  it("fails verification when rendered content differs from the intended blocks", async () => {
    const docx = await renderDocx(blocks);
    const altered = [...blocks];
    altered[3] = line("A claim that was never in the resume");
    const result = await verifyRenderedResume(docx, altered);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("content_mismatch");
    // Only counts are returned: no candidate text.
    expect(JSON.stringify(result)).not.toContain("never in the resume");

    const dropped = await verifyRenderedResume(docx, [...blocks, line("Extra required line")]);
    expect(dropped.issues).toEqual(expect.arrayContaining(["content_mismatch", "missing_text"]));
    const extra = await verifyRenderedResume(docx, blocks.slice(1));
    expect(extra.issues).toContain("extra_text");
  });

  it("reports unparseable artifacts and overlong PDFs", async () => {
    const garbage = {
      mediaType: "application/pdf" as const,
      bytes: new TextEncoder().encode("not a pdf"),
      sha256: "0".repeat(64),
    };
    expect((await verifyRenderedResume(garbage, blocks)).issues).toContain("unparseable");
    const many = Array.from({ length: 160 }, (_, index) =>
      line(`Line number ${index} of a long resume`),
    );
    const pdf = renderPdf(many);
    expect(pdf.pageCount).toBeGreaterThan(2);
    expect((await verifyRenderedResume(pdf, many)).issues).toContain("too_many_pages");
  });

  it("refuses characters the standard PDF font cannot represent instead of substituting", async () => {
    expect(() => renderPdf([line("你好")])).toThrow(RenderError);
    expect(() => renderPdf([])).toThrow(RenderError);
    const docx = await renderDocx([line("你好")]);
    expect(await verifyRenderedResume(docx, [line("你好")])).toMatchObject({ ok: true });
    await expect(renderDocx([line(`bad${String.fromCharCode(1)}control`)])).rejects.toThrow(
      RenderError,
    );
  });
});

describe("resumes with visual bullet markers", () => {
  it("render and verify in both formats instead of being refused", async () => {
    const circle = String.fromCodePoint(0x25cf);
    const circled = SYNTHETIC_RESUME.map((text) =>
      text.startsWith("• ") ? `${circle}${text.slice(1)}` : text,
    );
    expect(circled.some((text) => text.startsWith(circle))).toBe(true);
    const circledAst = buildResumeAst(syntheticDocument(circled));
    const circledBlocks = materializeTailoredResume(
      circledAst,
      tailorResume(circledAst, { title: "Backend Engineer", description: "TypeScript PostgreSQL" }),
    );
    expect(circledBlocks.some((block) => block.text.includes(circle))).toBe(false);
    expect(await verifyRenderedResume(renderPdf(circledBlocks), circledBlocks)).toMatchObject({
      ok: true,
    });
    expect(
      await verifyRenderedResume(await renderDocx(circledBlocks), circledBlocks),
    ).toMatchObject({
      ok: true,
    });
  });
});

describe("Windows-1252 characters in the standard fonts", () => {
  it("draws and re-reads trademark, euro, dagger and curly quotes", async () => {
    const expected = [line("Acme™ Platform – €5M ARR † “quoted” ‘single’ …")];
    const pdf = renderPdf(expected);
    expect(await verifyRenderedResume(pdf, expected)).toMatchObject({ ok: true, issues: [] });
  });

  it("still refuses a character outside Windows-1252", () => {
    expect(() => renderPdf([line("Arrow → here")])).toThrow(RenderError);
  });
});
