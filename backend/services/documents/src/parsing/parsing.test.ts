import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { parseResume } from "./index.js";
import { parseDocx } from "./docx.js";
import { InvalidDocumentError, ParseLimitError } from "./limits.js";
import { normalizeBlocks } from "./normalize.js";

function minimalPdf(text: string): Uint8Array {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${escaped.length + 29} >>\nstream\nBT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source));
    source += object;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

function docx(entries: ReadonlyArray<{ name: string; value: string }>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) zip.addBuffer(Buffer.from(entry.value), entry.name);
    zip.end();
  });
}

const contentTypes =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';

describe("bounded resume parsing", () => {
  it("extracts deterministic normalized text from a PDF", async () => {
    const bytes = minimalPdf("Taylor Candidate - TypeScript");
    const normalized = await parseResume({
      documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
      documentVersion: 1,
      parserVersion: "resume-parser-v1",
      mediaType: "application/pdf",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      createdAt: "2026-08-12T12:00:00.000Z",
      bytes,
    });
    expect(normalized.blocks).toEqual([
      expect.objectContaining({ index: 0, text: "Taylor Candidate - TypeScript", page: 1 }),
    ]);
  });

  it("extracts allowlisted WordprocessingML paragraphs", async () => {
    const bytes = await docx([
      { name: "[Content_Types].xml", value: contentTypes },
      {
        name: "word/document.xml",
        value:
          '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Skills: TypeScript, PostgreSQL</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const blocks = await parseDocx(bytes);
    expect(normalizeBlocks(blocks).map((block) => block.text)).toEqual([
      "Skills: TypeScript, PostgreSQL",
    ]);
  });

  it("rejects traversal, DTDs, active PDF tokens, and excessive blocks", async () => {
    const activePackage = await docx([
      { name: "[Content_Types].xml", value: contentTypes },
      { name: "word/document.xml", value: "<w:document/>" },
      { name: "word/vbaProject.bin", value: "bad" },
    ]);
    await expect(parseDocx(activePackage)).rejects.toBeInstanceOf(InvalidDocumentError);

    const dtd = await docx([
      { name: "[Content_Types].xml", value: contentTypes },
      { name: "word/document.xml", value: "<!DOCTYPE x><w:document/>" },
    ]);
    await expect(parseDocx(dtd)).rejects.toBeInstanceOf(InvalidDocumentError);

    const activePdf = minimalPdf("/JavaScript");
    await expect(
      parseResume({
        documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        documentVersion: 1,
        parserVersion: "resume-parser-v1",
        mediaType: "application/pdf",
        sourceSha256: createHash("sha256").update(activePdf).digest("hex"),
        createdAt: "2026-08-12T12:00:00.000Z",
        bytes: activePdf,
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);

    const escapedActivePdf = minimalPdf("/Java#53cript");
    await expect(
      parseResume({
        documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        documentVersion: 1,
        parserVersion: "resume-parser-v1",
        mediaType: "application/pdf",
        sourceSha256: createHash("sha256").update(escapedActivePdf).digest("hex"),
        createdAt: "2026-08-12T12:00:00.000Z",
        bytes: escapedActivePdf,
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);

    expect(() => normalizeBlocks(Array.from({ length: 10_001 }, () => ({ text: "x" })))).toThrow(
      ParseLimitError,
    );
  });
});
