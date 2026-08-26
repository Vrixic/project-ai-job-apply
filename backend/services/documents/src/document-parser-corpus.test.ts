import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PARSER_CORPUS_CASE_COUNT,
  type DocumentParserCorpusCase,
  documentParserCorpusSha256,
  executeDocumentParserCorpus,
} from "./document-parser-corpus.js";

function cases(): DocumentParserCorpusCase[] {
  return Array.from({ length: DOCUMENT_PARSER_CORPUS_CASE_COUNT }, (_, index) => {
    const ordinal = String(index + 1).padStart(3, "0");
    const documentId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return {
      caseId: `pdf-${ordinal}`,
      documentId,
      sourceObjectKey: `quarantine/${documentId}/source`,
      sourceObjectVersion: `version-${ordinal}`,
      mediaType: "application/pdf",
      sizeBytes: 100,
      sha256: String(index).padStart(64, "0"),
      createdAt: "2026-08-26T12:00:00.000Z",
      expectedFailureCode: "invalid_document",
      expectedReasonCode: "PDF_MAGIC_OR_EOF",
    };
  });
}

function request() {
  const entries = cases();
  return {
    schemaVersion: 1 as const,
    kind: "development-document-parser-corpus-v1" as const,
    corpusVersion: "document-parser-adversarial-v1",
    corpusSha256: documentParserCorpusSha256(entries),
    releaseSourceSha: "a".repeat(40),
    runId: "12345678-1234-4abc-8def-1234567890ab",
    cases: entries,
  };
}

describe("deployed document parser corpus contract", () => {
  it("returns only aggregate reason-code evidence", async () => {
    const aggregate = await executeDocumentParserCorpus(request(), "resume-parser-v1", {
      parse: async () => ({
        ok: false,
        failureCode: "invalid_document",
        reasonCode: "PDF_MAGIC_OR_EOF",
      }),
    });
    expect(aggregate).toEqual({
      schemaVersion: 1,
      profile: "d1_deployed_document_parser_adversarial_corpus_v1",
      corpusVersion: "document-parser-adversarial-v1",
      corpusSha256: request().corpusSha256,
      releaseSourceSha: "a".repeat(40),
      runId: "12345678-1234-4abc-8def-1234567890ab",
      parserVersion: "resume-parser-v1",
      caseCount: 43,
      rejectedCount: 43,
      databaseAccessed: false,
      reasonCodeCounts: { PDF_MAGIC_OR_EOF: 43 },
    });
    expect(JSON.stringify(aggregate)).not.toContain("sourceObject");
    expect(JSON.stringify(aggregate)).not.toContain("documentId");
  });

  it.each([
    [
      "extra property",
      (value: ReturnType<typeof request>) => Object.assign(value, { payload: "x" }),
    ],
    ["wrong digest", (value: ReturnType<typeof request>) => (value.corpusSha256 = "0".repeat(64))],
    ["wrong count", (value: ReturnType<typeof request>) => value.cases.pop()],
    [
      "duplicate ID",
      (value: ReturnType<typeof request>) => {
        const first = value.cases.at(0);
        const second = value.cases.at(1);
        if (!first || !second) throw new Error("test corpus is incomplete");
        second.caseId = first.caseId;
      },
    ],
  ])("rejects %s", async (_name, mutate) => {
    const value = request();
    mutate(value);
    await expect(
      executeDocumentParserCorpus(value, "resume-parser-v1", {
        parse: async () => ({
          ok: false,
          failureCode: "invalid_document",
          reasonCode: "PDF_MAGIC_OR_EOF",
        }),
      }),
    ).rejects.toThrow();
  });

  it("rejects a mismatched deployed reason code", async () => {
    await expect(
      executeDocumentParserCorpus(request(), "resume-parser-v1", {
        parse: async () => ({
          ok: false,
          failureCode: "parse_failed",
          reasonCode: "PDF_PAGE_LIMIT",
        }),
      }),
    ).rejects.toThrow("DocumentParserCorpusExpectationMismatch");
  });
});
