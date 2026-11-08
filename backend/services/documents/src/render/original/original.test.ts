import { describe, expect, it } from "vitest";
import { buildResumeAst } from "../../resume-ast/build.js";
import { materializeTailoredResume, tailorResume } from "../../tailoring/tailor.js";
import { renderTailoredPdf } from "../render.js";
import { verifyRenderedResume } from "../verify.js";
import { editOriginalPdf, OriginalEditUnsupported, sourceLinesOf } from "./index.js";
import { linksOf, PAGE, parse, resumePdf, runsByText } from "./test-support.js";

async function tailored(bytes: Uint8Array, maxBulletsPerEntry?: number) {
  const ast = buildResumeAst(await parse(bytes));
  const result = tailorResume(
    ast,
    { title: "Graphics Programmer", description: "Vulkan renderer shader work" },
    maxBulletsPerEntry ? { maxBulletsPerEntry } : {},
  );
  return { ast, blocks: materializeTailoredResume(ast, result) };
}

describe("editing the candidate's own PDF in place", () => {
  it("keeps the candidate's design and changes only which text blocks are there and where", async () => {
    const original = await resumePdf();
    const { ast, blocks } = await tailored(original, 2);
    const result = await renderTailoredPdf(blocks, ast.page, {
      bytes: original,
      sourceLines: sourceLinesOf(ast),
    });

    expect(result.method).toBe("original_page");
    expect((await verifyRenderedResume(result, blocks)).ok).toBe(true);

    // Every surviving line is drawn exactly as it was: same font weight, size, color and left edge.
    const before = await runsByText(original);
    const after = await runsByText(result.bytes);
    expect(after.size).toBeGreaterThan(3);
    for (const [text, style] of after) {
      const was = before.get(text);
      expect(was, text).toBeDefined();
      expect({ ...style, y: undefined }).toEqual({ ...was, y: undefined });
    }
    // The heading and the name did not move; the dropped bullet is gone.
    expect(after.get("Alex Example")?.y).toBe(before.get("Alex Example")?.y);
    expect(after.get("Projects")?.y).toBe(before.get("Projects")?.y);
    const kept = [
      "Wrote tools for the art team",
      "Built a Vulkan renderer with shader reloading",
    ].filter((text) => after.has(text) || [...after.keys()].some((key) => key.includes(text)));
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect([...after.keys()].some((key) => key.includes("Mentored"))).toBe(false);
  });

  it("moves the link with its line and keeps only its address", async () => {
    // The parser refuses a file with a script in it, so the plan comes from the clean copy and the
    // editor is handed the file that also carries a script link.
    const { ast, blocks } = await tailored(await resumePdf());
    const result = await editOriginalPdf({
      original: await resumePdf({ scriptLink: true }),
      blocks,
      sourceLines: sourceLinesOf(ast),
      page: ast.page as NonNullable<typeof ast.page>,
    });

    const links = await linksOf(result.bytes);
    expect(links).toHaveLength(1);
    expect(links[0]?.uri).toBe("https://example.com/renderer");
    const after = await runsByText(result.bytes);
    const row = [...after.entries()].find(([text]) => text.includes("Vulkan renderer"));
    expect(row).toBeDefined();
    const baseline = PAGE.height - (row?.[1].y ?? 0);
    // The link rectangle sits on the line it belongs to, wherever that line ended up.
    expect(links[0]?.rectY).toBeGreaterThan(baseline - 8);
    expect(links[0]?.rectY).toBeLessThan(baseline);
  });

  it("writes none of the original's scripts, actions, metadata or unused objects", async () => {
    const { ast, blocks } = await tailored(await resumePdf());
    const result = await editOriginalPdf({
      original: await resumePdf({ scriptLink: true }),
      blocks,
      sourceLines: sourceLinesOf(ast),
      page: ast.page as NonNullable<typeof ast.page>,
    });
    const text = Buffer.from(result.bytes).toString("latin1");
    for (const forbidden of [
      "/JavaScript",
      "/JS",
      "/OpenAction",
      "/AA",
      "/Launch",
      "/Names",
      "/Info",
    ])
      expect(text, forbidden).not.toContain(forbidden);
    expect(result.method).toBeUndefined();
    expect(result.pageCount).toBe(1);
  });

  it("reads an uncompressed content stream the same way", async () => {
    const original = await resumePdf({ compress: false });
    const { ast, blocks } = await tailored(original);
    const result = await renderTailoredPdf(blocks, ast.page, {
      bytes: original,
      sourceLines: sourceLinesOf(ast),
    });
    expect(result.method).toBe("original_page");
  });

  it("draws from the recorded layout instead when the page uses something it does not follow", async () => {
    const { ast, blocks } = await tailored(await resumePdf());
    const original = await resumePdf({ formXObjectText: true });
    await expect(
      editOriginalPdf({
        original,
        blocks,
        sourceLines: sourceLinesOf(ast),
        page: ast.page as NonNullable<typeof ast.page>,
      }),
    ).rejects.toBeInstanceOf(OriginalEditUnsupported);
    const result = await renderTailoredPdf(blocks, ast.page, {
      bytes: original,
      sourceLines: sourceLinesOf(ast),
    });
    expect(result.method).not.toBe("original_page");
    expect((await verifyRenderedResume(result, blocks)).ok).toBe(true);
  });

  it("refuses bytes that are not a readable PDF", async () => {
    const original = await resumePdf();
    const { ast, blocks } = await tailored(original);
    await expect(
      editOriginalPdf({
        original: new TextEncoder().encode("not a pdf"),
        blocks,
        sourceLines: sourceLinesOf(ast),
        page: ast.page as NonNullable<typeof ast.page>,
      }),
    ).rejects.toBeInstanceOf(OriginalEditUnsupported);
  });
});

describe.each([
  ["one block per text run", { columns: true }],
  ["inside a clip wrapper with marked-content glue", { columns: true, wrapped: true }],
])("a page with a second column, %s", (_name, options) => {
  it("edits the left column and leaves the right column exactly where it was", async () => {
    const original = await resumePdf(options);
    const document = await parse(original);
    // The parser records the second column as its own reading zone.
    expect(document.blocks.some((block) => block.layout?.zone === 1)).toBe(true);

    const { ast, blocks } = await tailored(original, 2);
    const result = await renderTailoredPdf(blocks, ast.page, {
      bytes: original,
      sourceLines: sourceLinesOf(ast),
    });
    expect(result.method).toBe("original_page");
    expect((await verifyRenderedResume(result, blocks)).ok).toBe(true);

    const before = await runsByText(original);
    const after = await runsByText(result.bytes);
    for (const text of ["Skills", "C++, Unity, Vulkan", "Scrum and Jira"])
      expect(after.get(text), text).toEqual(before.get(text));
    expect([...after.keys()].some((key) => key.includes("Mentored"))).toBe(false);
    expect((await linksOf(result.bytes)).map((link) => link.uri)).toEqual([
      "https://example.com/renderer",
    ]);
  });
});

describe("a page written the way Google Docs (Skia) exports it", () => {
  it("is edited in place through the page's flipped matrix, Td positioning and a two-line block", async () => {
    const original = await resumePdf({ skia: true });
    const document = await parse(original);
    expect(document.page).toEqual({ width: 612, height: 792 });
    expect(document.blocks.every((block) => block.layout)).toBe(true);

    const { ast, blocks } = await tailored(original, 2);
    const result = await renderTailoredPdf(blocks, ast.page, {
      bytes: original,
      sourceLines: sourceLinesOf(ast),
    });
    expect(result.method).toBe("original_page");
    expect((await verifyRenderedResume(result, blocks)).ok).toBe(true);

    const before = await runsByText(original);
    const after = await runsByText(result.bytes);
    // The header block, which holds two lines, did not move.
    expect(after.get("Alex Example")).toEqual(before.get("Alex Example"));
    expect(after.get("Springfield 555-0100")).toEqual(before.get("Springfield 555-0100"));
    // What survived is drawn exactly as it was, and what was left out is gone.
    for (const [text, style] of after) {
      const was = before.get(text);
      expect(was, text).toBeDefined();
      expect({ ...style, y: undefined }).toEqual({ ...was, y: undefined });
    }
    expect([...after.keys()].some((key) => key.includes("Mentored"))).toBe(false);
    // The link follows its line even though the page is drawn upside down underneath.
    const links = await linksOf(result.bytes);
    expect(links.map((link) => link.uri)).toEqual(["https://example.com/renderer"]);
    const row = [...after.entries()].find(([text]) => text.includes("Vulkan renderer"));
    const baseline = PAGE.height - (row?.[1].y ?? 0);
    expect(links[0]?.rectY).toBeGreaterThan(baseline - 8);
    expect(links[0]?.rectY).toBeLessThan(baseline);
  });
});
