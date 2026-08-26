import { createHash } from "node:crypto";
import type { DocumentParserResult } from "./parser-lambda.js";
import type { DocumentProcessingJob } from "./processor.js";

export const DOCUMENT_PARSER_CORPUS_VERSION = "document-parser-adversarial-v1";
export const DOCUMENT_PARSER_CORPUS_CASE_COUNT = 43;

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CASE_ID = /^(?:docx|pdf)-[0-9]{3}$/u;
const REASON_CODE = /^[A-Z0-9_]{1,64}$/u;

export interface DocumentParserCorpusCase {
  caseId: string;
  documentId: string;
  sourceObjectKey: string;
  sourceObjectVersion: string;
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expectedFailureCode: "invalid_document" | "parse_failed";
  expectedReasonCode: string;
}

export interface DocumentParserCorpusRequest {
  schemaVersion: 1;
  kind: "development-document-parser-corpus-v1";
  corpusVersion: string;
  corpusSha256: string;
  releaseSourceSha: string;
  runId: string;
  cases: DocumentParserCorpusCase[];
}

export interface DocumentParserCorpusAggregate {
  schemaVersion: 1;
  profile: "d1_deployed_document_parser_adversarial_corpus_v1";
  corpusVersion: string;
  corpusSha256: string;
  releaseSourceSha: string;
  runId: string;
  parserVersion: string;
  caseCount: number;
  rejectedCount: number;
  databaseAccessed: false;
  reasonCodeCounts: Record<string, number>;
}

export interface CorpusParserClient {
  parse(job: DocumentProcessingJob): Promise<DocumentParserResult>;
}

export function documentParserCorpusSha256(
  cases: readonly Pick<
    DocumentParserCorpusCase,
    "caseId" | "mediaType" | "sizeBytes" | "sha256" | "expectedFailureCode" | "expectedReasonCode"
  >[],
): string {
  const canonical = [...cases]
    .sort((left, right) => left.caseId.localeCompare(right.caseId))
    .map(({ caseId, mediaType, sizeBytes, sha256, expectedFailureCode, expectedReasonCode }) => ({
      caseId,
      mediaType,
      sizeBytes,
      sha256,
      expectedFailureCode,
      expectedReasonCode,
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) {
    throw new Error("DocumentParserCorpusShapeInvalid");
  }
}

export function assertDocumentParserCorpusRequest(
  value: unknown,
): asserts value is DocumentParserCorpusRequest {
  if (!value || typeof value !== "object") throw new Error("DocumentParserCorpusRequestInvalid");
  const request = value as Partial<DocumentParserCorpusRequest>;
  assertExactKeys(request, [
    "schemaVersion",
    "kind",
    "corpusVersion",
    "corpusSha256",
    "releaseSourceSha",
    "runId",
    "cases",
  ]);
  if (
    request.schemaVersion !== 1 ||
    request.kind !== "development-document-parser-corpus-v1" ||
    request.corpusVersion !== DOCUMENT_PARSER_CORPUS_VERSION ||
    typeof request.corpusSha256 !== "string" ||
    !SHA256.test(request.corpusSha256) ||
    typeof request.releaseSourceSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(request.releaseSourceSha) ||
    typeof request.runId !== "string" ||
    !RUN_ID.test(request.runId) ||
    !Array.isArray(request.cases) ||
    request.cases.length !== DOCUMENT_PARSER_CORPUS_CASE_COUNT
  ) {
    throw new Error("DocumentParserCorpusRequestInvalid");
  }
  const ids = new Set<string>();
  const documentIds = new Set<string>();
  for (const candidate of request.cases) {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("DocumentParserCorpusCaseInvalid");
    }
    const entry = candidate as DocumentParserCorpusCase;
    assertExactKeys(entry, [
      "caseId",
      "documentId",
      "sourceObjectKey",
      "sourceObjectVersion",
      "mediaType",
      "sizeBytes",
      "sha256",
      "createdAt",
      "expectedFailureCode",
      "expectedReasonCode",
    ]);
    if (
      !CASE_ID.test(entry.caseId) ||
      ids.has(entry.caseId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        entry.documentId,
      ) ||
      documentIds.has(entry.documentId) ||
      entry.sourceObjectKey !== `quarantine/${entry.documentId}/source` ||
      !entry.sourceObjectVersion ||
      entry.sourceObjectVersion.length > 1024 ||
      (entry.mediaType !== "application/pdf" &&
        entry.mediaType !==
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
      !Number.isInteger(entry.sizeBytes) ||
      entry.sizeBytes < 1 ||
      entry.sizeBytes > 5_242_880 ||
      !SHA256.test(entry.sha256) ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      (entry.expectedFailureCode !== "invalid_document" &&
        entry.expectedFailureCode !== "parse_failed") ||
      !REASON_CODE.test(entry.expectedReasonCode)
    ) {
      throw new Error("DocumentParserCorpusCaseInvalid");
    }
    ids.add(entry.caseId);
    documentIds.add(entry.documentId);
  }
  if (documentParserCorpusSha256(request.cases) !== request.corpusSha256) {
    throw new Error("DocumentParserCorpusDigestMismatch");
  }
}

export async function executeDocumentParserCorpus(
  request: unknown,
  parserVersion: string,
  parser: CorpusParserClient,
): Promise<DocumentParserCorpusAggregate> {
  assertDocumentParserCorpusRequest(request);
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(parserVersion)) {
    throw new Error("DocumentParserCorpusVersionInvalid");
  }
  const counts: Record<string, number> = {};
  for (const entry of request.cases) {
    const result = await parser.parse({
      documentId: entry.documentId,
      userId: "00000000-0000-4000-8000-000000000000",
      traceId: `document-parser-corpus:${request.runId}`,
      documentVersion: 1,
      sourceObjectKey: entry.sourceObjectKey,
      sourceObjectVersion: entry.sourceObjectVersion,
      mediaType: entry.mediaType,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
      createdAt: entry.createdAt,
    });
    if (
      result.ok ||
      result.failureCode !== entry.expectedFailureCode ||
      result.reasonCode !== entry.expectedReasonCode
    ) {
      throw new Error("DocumentParserCorpusExpectationMismatch");
    }
    counts[result.reasonCode] = (counts[result.reasonCode] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    profile: "d1_deployed_document_parser_adversarial_corpus_v1",
    corpusVersion: request.corpusVersion,
    corpusSha256: request.corpusSha256,
    releaseSourceSha: request.releaseSourceSha,
    runId: request.runId,
    parserVersion,
    caseCount: request.cases.length,
    rejectedCount: request.cases.length,
    databaseAccessed: false,
    reasonCodeCounts: Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}
