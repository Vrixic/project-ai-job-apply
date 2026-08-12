export const DOCUMENT_LIMITS = {
  sourceBytes: 5 * 1024 * 1024,
  pages: 50,
  characters: 200_000,
  blocks: 10_000,
  blockCharacters: 20_000,
  pdfTextItems: 50_000,
  zipEntries: 512,
  zipEntryBytes: 2 * 1024 * 1024,
  zipTotalBytes: 20 * 1024 * 1024,
  zipCompressionRatio: 100,
  xmlDepth: 128,
} as const;

export class InvalidDocumentError extends Error {
  readonly failureCode = "invalid_document" as const;

  constructor(readonly reasonCode: string) {
    super("Document content is not an accepted resume document");
    this.name = "InvalidDocumentError";
  }
}

export class ParseLimitError extends Error {
  readonly failureCode = "parse_failed" as const;

  constructor(readonly reasonCode: string) {
    super("Document parsing exceeded a safety limit");
    this.name = "ParseLimitError";
  }
}
