import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseResume } from "./index.js";

const FONTS = [
  ["F1", "Helvetica"],
  ["F2", "Helvetica-Bold"],
  ["F3", "Times-Roman"],
  ["F4", "Courier"],
  ["F5", "Helvetica-Oblique"],
] as const;

/** A one-page PDF around a raw content stream, with the five standard fonts above. */
function pdf(content: string, pageEntries = ""): Uint8Array {
  const fonts = FONTS.map(([name], index) => `/${name} ${5 + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${pageEntries} /Resources << /Font << ${fonts} >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...FONTS.map(([, base]) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} >>`),
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = source.length;
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = source.length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join("")}`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

async function parse(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return parseResume({
    documentId: "019d04cf-1f80-7000-8000-000000000001",
    documentVersion: 1,
    parserVersion: "layout-test",
    mediaType: "application/pdf",
    sourceSha256: createHash("sha256").update(copy).digest("hex"),
    createdAt: "2026-10-21T12:00:00.000Z",
    bytes: copy,
  });
}

const text = (font: string, size: number, x: number, y: number, value: string, color = "0 g") =>
  `BT /${font} ${size} Tf ${color} ${x} ${y} Td (${value}) Tj ET`;

describe("PDF layout extraction", () => {
  it("reads position, size, font traits, color and rules of each line", async () => {
    const parsed = await parse(
      pdf(
        [
          text("F2", 20, 36, 740, "Technical Skills", "0.8 0 0 rg"),
          "0 0 0 rg 36 730 540 0.8 re f",
          text("F3", 11, 54, 700, "Serif body line"),
          text("F4", 10, 54, 680, "Mono code line"),
          text("F5", 11, 54, 660, "Slanted line"),
        ].join("\n"),
      ),
    );
    expect(parsed.page).toEqual({ width: 612, height: 792 });
    const [heading, serif, mono, slanted] = parsed.blocks.map((block) => block.layout);
    expect(heading?.runs[0]).toMatchObject({ x: 36, size: 20, bold: true, color: "#cc0000" });
    expect(heading?.y).toBeCloseTo(52, 0);
    expect(heading?.rules?.[0]).toMatchObject({ x0: 36, x1: 576 });
    expect(heading?.rules?.[0]?.dy).toBeCloseTo(9.2, 0);
    expect(serif?.runs[0]).toMatchObject({ x: 54, size: 11, family: "serif" });
    expect(mono?.runs[0]).toMatchObject({ size: 10, family: "mono" });
    expect(slanted?.runs[0]).toMatchObject({ italic: true });
    expect(serif?.runs[0]?.bold).toBeUndefined();
    expect(parsed.blocks.map((block) => block.text)).toEqual([
      "Technical Skills",
      "Serif body line",
      "Mono code line",
      "Slanted line",
    ]);
  });

  it("splits a run where its fill color changes", async () => {
    const parsed = await parse(
      pdf("BT /F1 12 Tf 36 700 Td 0 g (See my site ) Tj 0.07 0.33 0.8 rg (example.test/me) Tj ET"),
    );
    const runs = parsed.blocks[0]?.layout?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(["See my site", "example.test/me"]);
    expect(runs[0]?.color).toBeUndefined();
    expect(runs[1]?.color).toBe("#1254cc");
    expect(runs[1]?.x).toBeGreaterThan(runs[0]?.x ?? 0);
  });

  it("restores the fill color when a saved state ends", async () => {
    const parsed = await parse(
      pdf(
        [
          `q ${text("F1", 12, 36, 700, "Colored", "1 0 0 rg")} Q`,
          text("F1", 12, 36, 680, "Back to black"),
        ].join("\n"),
      ),
    );
    expect(parsed.blocks[0]?.layout?.runs[0]?.color).toBe("#ff0000");
    expect(parsed.blocks[1]?.layout?.runs[0]?.color).toBeUndefined();
  });

  it("finds a rule stroked under the page's own vertical flip", async () => {
    const parsed = await parse(
      pdf(
        [
          text("F1", 14, 36, 700, "Heading"),
          // A flipped coordinate system, as some exporters use, with a 36 to 576 line at y=100.
          "q 1 0 0 -1 0 792 cm 0.5 w 0.5 0.5 0.5 RG 36 100 m 576 100 l S Q",
        ].join("\n"),
      ),
    );
    const rule = parsed.blocks[0]?.layout?.rules?.[0];
    expect(rule).toMatchObject({ x0: 36, x1: 576 });
    expect(rule?.color).toBe("#808080");
    expect(rule?.dy).toBeGreaterThan(0);
  });

  it("gives no layout for text that is not read top to bottom, but still returns the text", async () => {
    const parsed = await parse(
      pdf(
        [text("F1", 12, 36, 600, "Lower first"), text("F1", 12, 36, 700, "Higher second")].join(
          "\n",
        ),
      ),
    );
    expect(parsed.blocks.map((block) => block.text)).toEqual(["Lower first", "Higher second"]);
    expect(parsed.page).toBeUndefined();
    expect(parsed.blocks.every((block) => block.layout === undefined)).toBe(true);
  });

  it("gives no layout for a rotated page, but still returns the text", async () => {
    const parsed = await parse(pdf(text("F1", 12, 36, 700, "Sideways page"), "/Rotate 90"));
    expect(parsed.blocks[0]?.text).toBe("Sideways page");
    expect(parsed.page).toBeUndefined();
  });
});
