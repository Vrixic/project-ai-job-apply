import { ZipFile } from "yazl";
import { DOCUMENT_LIMITS } from "./limits.js";

export const GENERATED_DOCUMENT_CORPUS_VERSION = "document-parser-adversarial-v1";

export const CONTENT_TYPES_XML =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';

export const EMPTY_WORD_DOCUMENT_XML =
  '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body/></w:document>';

export interface GeneratedZipEntry {
  name: string;
  value: string | Uint8Array;
  compress?: boolean;
}

export function generatedMinimalPdf(text: string, pageCount = 1): Uint8Array {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const pageObjectNumbers = Array.from({ length: pageCount }, (_, index) => index + 3);
  const contentObjectNumber = pageCount + 3;
  const fontObjectNumber = pageCount + 4;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers
      .map((number) => `${number} 0 R`)
      .join(" ")}] /Count ${pageCount} >>\nendobj\n`,
    ...pageObjectNumbers.map(
      (number) =>
        `${number} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>\nendobj\n`,
    ),
    `${contentObjectNumber} 0 obj\n<< /Length ${escaped.length + 29} >>\nstream\nBT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\nendstream\nendobj\n`,
    `${fontObjectNumber} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source));
    source += object;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

export function generatedDocx(entries: readonly GeneratedZipEntry[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) {
      zip.addBuffer(
        Buffer.from(entry.value),
        entry.name,
        entry.compress === undefined ? undefined : { compress: entry.compress },
      );
    }
    zip.end();
  });
}

export function generatedBaseDocx(
  extraEntries: readonly GeneratedZipEntry[] = [],
  documentXml = EMPTY_WORD_DOCUMENT_XML,
): Promise<Uint8Array> {
  return generatedDocx([
    { name: "[Content_Types].xml", value: CONTENT_TYPES_XML },
    { name: "word/document.xml", value: documentXml },
    ...extraEntries,
  ]);
}

function replaceEverySameLength(bytes: Uint8Array, before: string, after: string): Uint8Array {
  const source = Buffer.from(bytes);
  const beforeBytes = Buffer.from(before);
  const afterBytes = Buffer.from(after);
  if (beforeBytes.length !== afterBytes.length) throw new Error("replacement length mismatch");
  let replacements = 0;
  let offset = source.indexOf(beforeBytes);
  while (offset >= 0) {
    afterBytes.copy(source, offset);
    replacements += 1;
    offset = source.indexOf(beforeBytes, offset + afterBytes.length);
  }
  if (replacements < 2) throw new Error(`ZIP entry name was not found twice: ${before}`);
  return source;
}

export function generatedRenamedZipEntry(
  bytes: Uint8Array,
  before: string,
  after: string,
): Uint8Array {
  return replaceEverySameLength(bytes, before, after);
}

interface CentralDirectoryMetadataPatch {
  encrypted?: boolean;
  compressedSize?: number;
  uncompressedSize?: number;
}

export function generatedCentralDirectoryMetadata(
  bytes: Uint8Array,
  entryName: string,
  patch: CentralDirectoryMetadataPatch,
): Uint8Array {
  const source = Buffer.from(bytes);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = source.indexOf(signature);
  while (offset >= 0) {
    const nameLength = source.readUInt16LE(offset + 28);
    const name = source.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === entryName) {
      if (patch.encrypted) {
        source.writeUInt16LE(source.readUInt16LE(offset + 8) | 0x1, offset + 8);
      }
      if (patch.compressedSize !== undefined) {
        source.writeUInt32LE(patch.compressedSize, offset + 20);
      }
      if (patch.uncompressedSize !== undefined) {
        source.writeUInt32LE(patch.uncompressedSize, offset + 24);
      }
      return source;
    }
    offset = source.indexOf(signature, offset + signature.length);
  }
  throw new Error(`ZIP central-directory entry was not found: ${entryName}`);
}

export interface GeneratedAdversarialCase {
  name: string;
  reasonCode: string;
  generate: () => Promise<Uint8Array> | Uint8Array;
}

const forbiddenDocxParts = [
  "word/vbaProject.bin",
  "word/custom.bin",
  "word/embeddings/object1.dat",
  "word/altChunk/content.html",
  "word/oleObject/object.xml",
  "word/payload.exe",
  "word/payload.js",
] as const;

export const generatedDocxAdversarialCorpus: readonly GeneratedAdversarialCase[] = [
  {
    name: "non-ZIP magic",
    reasonCode: "DOCX_MAGIC",
    generate: () => new TextEncoder().encode("not-a-zip"),
  },
  {
    name: "invalid ZIP structure",
    reasonCode: "DOCX_ZIP_REJECTED",
    generate: () => new Uint8Array([0x50, 0x4b, 0x00, 0x00]),
  },
  {
    name: "missing required Word document part",
    reasonCode: "DOCX_REQUIRED_PARTS",
    generate: () => generatedDocx([{ name: "[Content_Types].xml", value: CONTENT_TYPES_XML }]),
  },
  {
    name: "parent-directory traversal",
    reasonCode: "DOCX_ZIP_REJECTED",
    generate: async () =>
      generatedRenamedZipEntry(
        await generatedBaseDocx([{ name: "safe/payload.txt", value: "synthetic" }]),
        "safe/payload.txt",
        "../x/payload.txt",
      ),
  },
  {
    name: "backslash parent-directory traversal",
    reasonCode: "DOCX_ZIP_REJECTED",
    generate: async () =>
      generatedRenamedZipEntry(
        await generatedBaseDocx([{ name: "safe/payload.txt", value: "synthetic" }]),
        "safe/payload.txt",
        "..\\x/payload.txt",
      ),
  },
  {
    name: "absolute ZIP path",
    reasonCode: "DOCX_ZIP_REJECTED",
    generate: async () =>
      generatedRenamedZipEntry(
        await generatedBaseDocx([{ name: "xpayload.txt", value: "synthetic" }]),
        "xpayload.txt",
        "/payload.txt",
      ),
  },
  {
    name: "duplicate ZIP path",
    reasonCode: "DOCX_PATH_OR_DUPLICATE",
    generate: () =>
      generatedDocx([
        { name: "[Content_Types].xml", value: CONTENT_TYPES_XML },
        { name: "word/document.xml", value: EMPTY_WORD_DOCUMENT_XML },
        { name: "word/document.xml", value: EMPTY_WORD_DOCUMENT_XML },
      ]),
  },
  {
    name: "encrypted ZIP entry",
    reasonCode: "DOCX_ENCRYPTED_ENTRY",
    generate: async () =>
      generatedCentralDirectoryMetadata(await generatedBaseDocx(), "word/document.xml", {
        encrypted: true,
      }),
  },
  ...forbiddenDocxParts.map((name) => ({
    name: `active part ${name}`,
    reasonCode: "DOCX_ACTIVE_CONTENT",
    generate: () => generatedBaseDocx([{ name, value: "generated-active-content-marker" }]),
  })),
  {
    name: "nested ZIP archive",
    reasonCode: "DOCX_NESTED_ARCHIVE",
    generate: () => generatedBaseDocx([{ name: "word/nested.zip", value: "PK-generated" }]),
  },
  {
    name: "DTD in WordprocessingML",
    reasonCode: "DOCX_DTD_OR_ENTITY",
    generate: () => generatedBaseDocx([], '<!DOCTYPE x><w:document xmlns:w="urn:w"/>'),
  },
  {
    name: "entity declaration in WordprocessingML",
    reasonCode: "DOCX_DTD_OR_ENTITY",
    generate: () => generatedBaseDocx([], '<!ENTITY x "generated"><w:document xmlns:w="urn:w"/>'),
  },
  {
    name: "DTD in package relationships",
    reasonCode: "DOCX_DTD_OR_ENTITY",
    generate: () =>
      generatedBaseDocx([
        { name: "word/_rels/document.xml.rels", value: "<!DOCTYPE x><Relationships/>" },
      ]),
  },
  {
    name: "entity declaration in package relationships",
    reasonCode: "DOCX_DTD_OR_ENTITY",
    generate: () =>
      generatedBaseDocx([
        { name: "word/_rels/document.xml.rels", value: '<!ENTITY x "generated"><Relationships/>' },
      ]),
  },
  {
    name: "external package relationship",
    reasonCode: "DOCX_EXTERNAL_RELATIONSHIP",
    generate: () =>
      generatedBaseDocx([
        {
          name: "word/_rels/document.xml.rels",
          value:
            '<Relationships><Relationship TargetMode="External" Target="https://invalid.example"/></Relationships>',
        },
      ]),
  },
  {
    name: "ZIP entry-count expansion",
    reasonCode: "DOCX_ENTRY_COUNT",
    generate: () =>
      generatedBaseDocx(
        Array.from({ length: DOCUMENT_LIMITS.zipEntries - 1 }, (_, index) => ({
          name: `generated/entry-${String(index).padStart(3, "0")}.txt`,
          value: "",
        })),
      ),
  },
  {
    name: "oversized ZIP entry metadata",
    reasonCode: "DOCX_ENTRY_LIMIT",
    generate: async () =>
      generatedCentralDirectoryMetadata(await generatedBaseDocx(), "word/document.xml", {
        compressedSize: DOCUMENT_LIMITS.zipEntryBytes + 1,
        uncompressedSize: DOCUMENT_LIMITS.zipEntryBytes + 1,
      }),
  },
  {
    name: "aggregate ZIP inflation metadata",
    reasonCode: "DOCX_TOTAL_INFLATION_LIMIT",
    generate: async () => {
      const inflatedEntries = Array.from({ length: 10 }, (_, index) => ({
        name: `generated/inflated-${index}.txt`,
        value: "generated",
      }));
      let bytes = await generatedBaseDocx(inflatedEntries);
      for (const entry of inflatedEntries) {
        bytes = generatedCentralDirectoryMetadata(bytes, entry.name, {
          compressedSize: DOCUMENT_LIMITS.zipEntryBytes,
          uncompressedSize: DOCUMENT_LIMITS.zipEntryBytes,
        });
      }
      return bytes;
    },
  },
  {
    name: "excessive ZIP compression ratio metadata",
    reasonCode: "DOCX_COMPRESSION_RATIO",
    generate: async () =>
      generatedCentralDirectoryMetadata(
        await generatedBaseDocx([{ name: "generated/ratio.txt", value: "generated" }]),
        "generated/ratio.txt",
        {
          compressedSize: 10,
          uncompressedSize: DOCUMENT_LIMITS.zipCompressionRatio * 10 + 1,
        },
      ),
  },
  {
    name: "excessive WordprocessingML depth",
    reasonCode: "DOCX_XML_DEPTH",
    generate: () => {
      const count = DOCUMENT_LIMITS.xmlDepth + 1;
      return generatedBaseDocx(
        [],
        `<w:document xmlns:w="urn:w">${"<w:r>".repeat(count)}generated${"</w:r>".repeat(count)}</w:document>`,
      );
    },
  },
  {
    name: "malformed WordprocessingML",
    reasonCode: "DOCX_XML_REJECTED",
    generate: () => generatedBaseDocx([], '<w:document xmlns:w="urn:w"><w:body>'),
  },
] as const;

const forbiddenPdfTokens = [
  "/Encrypt",
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/XFA",
] as const;

function escapeFirstPdfNameCharacter(token: string): string {
  const firstCharacter = token.at(1);
  if (!firstCharacter) throw new Error("PDF name token is empty");
  return `/#${firstCharacter.codePointAt(0)?.toString(16).padStart(2, "0")}${token.slice(2)}`;
}

export const generatedPdfAdversarialCorpus: readonly GeneratedAdversarialCase[] = [
  {
    name: "non-PDF magic",
    reasonCode: "PDF_MAGIC_OR_EOF",
    generate: () => new TextEncoder().encode("not-a-pdf\n%%EOF"),
  },
  {
    name: "missing PDF EOF marker",
    reasonCode: "PDF_MAGIC_OR_EOF",
    generate: () => new TextEncoder().encode("%PDF-1.4\ngenerated"),
  },
  {
    name: "malformed PDF structure",
    reasonCode: "PDF_PARSE_REJECTED",
    generate: () => new TextEncoder().encode("%PDF-1.4\ngenerated-invalid-body\n%%EOF"),
  },
  ...forbiddenPdfTokens.flatMap((token) => [
    {
      name: `literal PDF name ${token}`,
      reasonCode: "PDF_ACTIVE_OR_ENCRYPTED_CONTENT",
      generate: () => generatedMinimalPdf(token),
    },
    {
      name: `escaped PDF name ${token}`,
      reasonCode: "PDF_ACTIVE_OR_ENCRYPTED_CONTENT",
      generate: () => generatedMinimalPdf(escapeFirstPdfNameCharacter(token)),
    },
  ]),
] as const;
