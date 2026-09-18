import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
import type { RenderBlock } from "../tailoring/tailor.js";

export class RenderError extends Error {
  constructor(readonly reasonCode: "UNSUPPORTED_CHARACTER" | "EMPTY_DOCUMENT" | "TOO_LONG") {
    super("The resume cannot be rendered in this format");
    this.name = "RenderError";
  }
}

export interface RenderedDocument {
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  bytes: Uint8Array;
  sha256: string;
  pageCount?: number;
}

const MAX_BLOCKS = 2_000;

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// XML 1.0 forbids most C0 controls; the AST never contains them, but refuse rather than sanitize.
function hasXmlForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
    if (code === 0xfffe || code === 0xffff) return true;
  }
  return false;
}

export async function renderDocx(blocks: readonly RenderBlock[]): Promise<RenderedDocument> {
  if (blocks.length === 0) throw new RenderError("EMPTY_DOCUMENT");
  if (blocks.length > MAX_BLOCKS) throw new RenderError("TOO_LONG");
  const paragraphs = blocks.map((block) => {
    if (hasXmlForbiddenCharacter(block.text)) throw new RenderError("UNSUPPORTED_CHARACTER");
    const properties = block.kind === "heading" ? "<w:pPr><w:keepNext/></w:pPr>" : "";
    const runProperties = block.kind === "heading" ? "<w:rPr><w:b/></w:rPr>" : "";
    return `<w:p>${properties}<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`;
  });
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}</w:body></w:document>`;
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rootRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Uint8Array.from(Buffer.concat(chunks))));
    // A fixed timestamp keeps the output byte-for-byte reproducible.
    const mtime = new Date("1980-01-01T00:00:00.000Z");
    zip.addBuffer(Buffer.from(contentTypes), "[Content_Types].xml", { mtime });
    zip.addBuffer(Buffer.from(rootRelationships), "_rels/.rels", { mtime });
    zip.addBuffer(Buffer.from(documentXml), "word/document.xml", { mtime });
    zip.end();
  });
  return {
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes,
    sha256: digest(bytes),
  };
}

// WinAnsi code points that differ from Latin-1 and are common in resumes.
const WIN_ANSI: ReadonlyMap<number, number> = new Map([
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2026, 0x85],
]);

function pdfString(text: string): string {
  let encoded = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const mapped = WIN_ANSI.get(codePoint);
    // Mapped WinAnsi codes live in 0x80-0x9F, which are only valid as the mapped characters.
    const code = mapped ?? codePoint;
    if (
      mapped === undefined &&
      (codePoint < 32 || (codePoint > 126 && codePoint < 160) || codePoint > 255)
    ) {
      throw new RenderError("UNSUPPORTED_CHARACTER");
    }
    if (character === "\\" || character === "(" || character === ")") encoded += `\\${character}`;
    else if (code > 126) encoded += `\\${code.toString(8).padStart(3, "0")}`;
    else encoded += character;
  }
  return encoded;
}

const PAGE = { width: 612, height: 792, margin: 54, fontSize: 10.5, leading: 13.5 } as const;
const MAX_LINE_CHARS = 88;
const LINES_PER_PAGE = Math.floor((PAGE.height - 2 * PAGE.margin) / PAGE.leading);
const MAX_PAGES = 10;

function wrap(text: string): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > MAX_LINE_CHARS) {
      if (line) lines.push(line);
      for (let index = 0; index < word.length; index += MAX_LINE_CHARS) {
        lines.push(word.slice(index, index + MAX_LINE_CHARS));
      }
      line = "";
      continue;
    }
    if (line && line.length + 1 + word.length > MAX_LINE_CHARS) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Minimal PDF 1.4 with the standard Helvetica font. Text is selectable and re-extractable. */
export function renderPdf(blocks: readonly RenderBlock[]): RenderedDocument {
  if (blocks.length === 0) throw new RenderError("EMPTY_DOCUMENT");
  if (blocks.length > MAX_BLOCKS) throw new RenderError("TOO_LONG");
  const lines = blocks.flatMap((block) =>
    wrap(block.text).map((text) => ({ text, bold: block.kind === "heading" })),
  );
  const pages: Array<typeof lines> = [];
  for (let index = 0; index < lines.length; index += LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + LINES_PER_PAGE));
  }
  if (pages.length > MAX_PAGES) throw new RenderError("TOO_LONG");

  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 2);
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`,
  );
  const fontRegular = 3 + pages.length * 2;
  const fontBold = fontRegular + 1;
  pages.forEach((pageLines, index) => {
    const pageNumber = 3 + index * 2;
    const stream = pageLines
      .map((line, row) => {
        const y = (PAGE.height - PAGE.margin - PAGE.fontSize - row * PAGE.leading).toFixed(2);
        return `BT /${line.bold ? "F2" : "F1"} ${PAGE.fontSize} Tf ${PAGE.margin} ${y} Td (${pdfString(line.text)}) Tj ET`;
      })
      .join("\n");
    objects.push(
      `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${pageNumber + 1} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${pageNumber + 1} 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });
  objects.push(
    `${fontRegular} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
  );
  objects.push(
    `${fontBold} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`,
  );

  let source = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source, "latin1"));
    source += object;
  }
  const xref = Buffer.byteLength(source, "latin1");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // A standalone copy: pooled Buffer slices confuse PDF.js, which reads the whole backing store.
  const bytes = Uint8Array.from(Buffer.from(source, "latin1"));
  return { mediaType: "application/pdf", bytes, sha256: digest(bytes), pageCount: pages.length };
}
