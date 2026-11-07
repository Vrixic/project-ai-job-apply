import { ZipFile } from "yazl";
import type { PageGeometry } from "../parsing/layout.js";
import type { AstLine } from "../resume-ast/types.js";
import type { RenderBlock } from "../tailoring/tailor.js";
import { editOriginalPdf } from "./original/index.js";
import { digest, pdfString, RenderError, type RenderedDocument } from "./pdf-text.js";
import { canRenderStyled, renderStyledPdf } from "./styled.js";
import { verifyRenderedResume } from "./verify.js";

export { RenderError, type RenderedDocument } from "./pdf-text.js";

const MAX_BLOCKS = 2_000;

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

/**
 * Minimal PDF 1.4 with the standard fonts. Text is selectable and re-extractable. When the source
 * resume's layout is known the tailored copy is set the way it was; otherwise it is plain text.
 */
export function renderPdf(blocks: readonly RenderBlock[], page?: PageGeometry): RenderedDocument {
  if (canRenderStyled(blocks, page)) return { ...renderStyledPdf(blocks, page), method: "styled" };
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
  return {
    mediaType: "application/pdf",
    bytes,
    sha256: digest(bytes),
    pageCount: pages.length,
    method: "plain",
  };
}

/**
 * The tailored resume as a PDF. When the candidate's own PDF is at hand it is edited in place, so the
 * fonts, colors, backgrounds, icons, rules and links are exactly theirs and only the text blocks the
 * tailoring left out or moved differ. When that is not possible (a structure the editor does not
 * follow, or an edit that would need text on another page) the resume is drawn from its recorded
 * layout, and failing that as plain text. Which way it was made is only ever reported as a word.
 */
export async function renderTailoredPdf(
  blocks: readonly RenderBlock[],
  page: PageGeometry | undefined,
  original?: { bytes: Uint8Array; sourceLines: readonly AstLine[]; maximumBytes?: number },
): Promise<RenderedDocument> {
  if (original && page && canRenderStyled(blocks, page)) {
    try {
      const edited: RenderedDocument = {
        ...(await editOriginalPdf({
          original: original.bytes,
          blocks,
          sourceLines: original.sourceLines,
          page,
        })),
        method: "original_page",
      };
      // The edit is only used when the file reads back as exactly the intended text, in order.
      const fits = edited.bytes.byteLength <= (original.maximumBytes ?? Number.POSITIVE_INFINITY);
      if (fits && (await verifyRenderedResume(edited, blocks)).ok) return edited;
    } catch {
      // Not editable in place: draw it from the recorded layout instead.
    }
  }
  return renderPdf(blocks, page);
}
