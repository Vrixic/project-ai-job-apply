import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseDocx } from "./docx.js";
import {
  CONTENT_TYPES_XML,
  GENERATED_DOCUMENT_CORPUS_VERSION,
  generatedDocx,
  generatedDocxAdversarialCorpus,
  generatedMinimalPdf,
  generatedPdfAdversarialCorpus,
} from "./generated-adversarial-corpus.js";
import { parseResume } from "./index.js";
import { DOCUMENT_LIMITS, type InvalidDocumentError, type ParseLimitError } from "./limits.js";
import { normalizeBlocks } from "./normalize.js";
import { parsePdf } from "./pdf.js";

const parseInput = {
  documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
  documentVersion: 1,
  parserVersion: "resume-parser-v1",
  createdAt: "2026-08-12T12:00:00.000Z",
} as const;

describe(`generated adversarial corpus ${GENERATED_DOCUMENT_CORPUS_VERSION}`, () => {
  describe("PDF envelope and active-content controls", () => {
    it.each(generatedPdfAdversarialCorpus)("rejects $name", async ({ generate, reasonCode }) => {
      await expect(parsePdf(await generate())).rejects.toMatchObject({
        name: "InvalidDocumentError",
        reasonCode,
      });
    });

    it("rejects a generated PDF over the page limit", async () => {
      await expect(
        parsePdf(generatedMinimalPdf("generated page-limit fixture", DOCUMENT_LIMITS.pages + 1)),
      ).rejects.toMatchObject({
        name: "ParseLimitError",
        reasonCode: "PDF_PAGE_LIMIT",
      });
    });
  });

  describe("DOCX package, XML, and expansion controls", () => {
    it.each(generatedDocxAdversarialCorpus)("rejects $name", async ({ generate, reasonCode }) => {
      await expect(parseDocx(await generate())).rejects.toMatchObject({ reasonCode });
    });
  });
});

describe("bounded resume parsing", () => {
  it("extracts deterministic normalized text from a PDF", async () => {
    const bytes = generatedMinimalPdf("Taylor Candidate - TypeScript");
    const normalized = await parseResume({
      ...parseInput,
      mediaType: "application/pdf",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      bytes,
    });
    expect(normalized.blocks).toEqual([
      expect.objectContaining({ index: 0, text: "Taylor Candidate - TypeScript", page: 1 }),
    ]);
  });

  it("extracts and orders only allowlisted WordprocessingML parts", async () => {
    const wordPart = (text: string) =>
      `<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
    const bytes = await generatedDocx([
      { name: "[Content_Types].xml", value: CONTENT_TYPES_XML },
      { name: "word/header1.xml", value: wordPart("Header") },
      { name: "word/document.xml", value: wordPart("Skills: TypeScript") },
      { name: "word/footnotes.xml", value: wordPart("Footnote") },
      { name: "word/footer1.xml", value: wordPart("Footer") },
      { name: "word/endnotes.xml", value: wordPart("Endnote") },
      { name: "word/styles.xml", value: wordPart("Not extracted") },
    ]);
    const blocks = await parseDocx(bytes);
    expect(normalizeBlocks(blocks).map((block) => block.text)).toEqual([
      "Skills: TypeScript",
      "Endnote",
      "Footer",
      "Footnote",
      "Header",
    ]);
  });

  it("preserves generated tab and line-break semantics before normalization", async () => {
    const bytes = await generatedDocx([
      { name: "[Content_Types].xml", value: CONTENT_TYPES_XML },
      {
        name: "word/document.xml",
        value:
          '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>TypeScript</w:t><w:tab/><w:t>PostgreSQL</w:t><w:br/><w:t>AWS</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    expect(normalizeBlocks(await parseDocx(bytes)).map((block) => block.text)).toEqual([
      "TypeScript PostgreSQL AWS",
    ]);
  });

  it("rejects empty sources and source digest mismatches before parsing", async () => {
    await expect(
      parseResume({
        ...parseInput,
        mediaType: "application/pdf",
        sourceSha256: createHash("sha256").update(new Uint8Array()).digest("hex"),
        bytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ reasonCode: "SOURCE_SIZE" });

    const bytes = generatedMinimalPdf("generated digest mismatch");
    await expect(
      parseResume({
        ...parseInput,
        mediaType: "application/pdf",
        sourceSha256: "0".repeat(64),
        bytes,
      }),
    ).rejects.toMatchObject({ reasonCode: "SOURCE_DIGEST" });
  });
});

describe("normalization safety controls", () => {
  it("removes unsupported control characters and calculates stable offsets", () => {
    expect(normalizeBlocks([{ text: "  Type\u0000Script\t  AWS  " }, { text: "SQL" }])).toEqual([
      { index: 0, text: "TypeScript AWS", startOffset: 0, endOffset: 14 },
      { index: 1, text: "SQL", startOffset: 15, endOffset: 18 },
    ]);
  });

  it("writes a leading visual bullet marker as the standard bullet and changes nothing else", () => {
    const circle = String.fromCodePoint(0x25cf);
    const bullet = String.fromCodePoint(0x2022);
    expect(
      normalizeBlocks([
        { text: `${circle} Built payments` },
        { text: `${bullet} Already standard` },
        { text: `Shipped ${circle} and ${circle}` },
        { text: `${circle}NoSpace` },
      ]),
    ).toEqual([
      { index: 0, text: `${bullet} Built payments`, startOffset: 0, endOffset: 16 },
      { index: 1, text: `${bullet} Already standard`, startOffset: 17, endOffset: 35 },
      { index: 2, text: `Shipped ${circle} and ${circle}`, startOffset: 36, endOffset: 51 },
      { index: 3, text: `${circle}NoSpace`, startOffset: 52, endOffset: 60 },
    ]);
  });

  it("rejects documents without usable text", () => {
    expect(() => normalizeBlocks([{ text: " \t\r\n " }])).toThrowError(
      expect.objectContaining<Partial<InvalidDocumentError>>({ reasonCode: "NO_USABLE_TEXT" }),
    );
  });

  it("enforces the block count limit", () => {
    expect(() =>
      normalizeBlocks(Array.from({ length: DOCUMENT_LIMITS.blocks + 1 }, () => ({ text: "x" }))),
    ).toThrowError(
      expect.objectContaining<Partial<ParseLimitError>>({ reasonCode: "BLOCK_COUNT_LIMIT" }),
    );
  });

  it("enforces the per-block character limit", () => {
    expect(() =>
      normalizeBlocks([{ text: "x".repeat(DOCUMENT_LIMITS.blockCharacters + 1) }]),
    ).toThrowError(
      expect.objectContaining<Partial<ParseLimitError>>({ reasonCode: "BLOCK_CHARACTER_LIMIT" }),
    );
  });

  it("enforces the total character limit", () => {
    const maximumBlock = "x".repeat(DOCUMENT_LIMITS.blockCharacters);
    expect(() =>
      normalizeBlocks([
        ...Array.from(
          { length: DOCUMENT_LIMITS.characters / DOCUMENT_LIMITS.blockCharacters },
          () => ({ text: maximumBlock }),
        ),
        { text: "x" },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<ParseLimitError>>({ reasonCode: "DOCUMENT_CHARACTER_LIMIT" }),
    );
  });
});
