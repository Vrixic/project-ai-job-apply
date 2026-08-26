#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if ((name !== "--run-id" && name !== "--output-directory") || !value) {
      throw new Error("The generated corpus arguments are invalid");
    }
    options[name.slice(2)] = value;
  }
  if (!RUN_ID.test(options["run-id"] ?? "") || !options["output-directory"]) {
    throw new Error("The generated corpus arguments are invalid");
  }
  return { runId: options["run-id"], outputDirectory: path.resolve(options["output-directory"]) };
}

function deterministicUuid(runId, caseId) {
  const bytes = createHash("sha256").update(`${runId}:${caseId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main() {
  const { runId, outputDirectory } = parseArguments(process.argv.slice(2));
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const corpusModule = await import(
    pathToFileURL(
      path.join(
        repositoryRoot,
        "backend/services/documents/dist/src/parsing/generated-adversarial-corpus.js",
      ),
    ).href
  );
  const parsingModule = await import(
    pathToFileURL(path.join(repositoryRoot, "backend/services/documents/dist/src/parsing/index.js"))
      .href
  );
  const contractModule = await import(
    pathToFileURL(
      path.join(repositoryRoot, "backend/services/documents/dist/src/document-parser-corpus.js"),
    ).href
  );
  const definitions = [
    ...corpusModule.generatedDocxAdversarialCorpus.map((entry) => ({
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ...entry,
    })),
    ...corpusModule.generatedPdfAdversarialCorpus.map((entry) => ({
      mediaType: "application/pdf",
      ...entry,
    })),
    {
      name: "PDF page limit",
      mediaType: "application/pdf",
      reasonCode: "PDF_PAGE_LIMIT",
      generate: () =>
        corpusModule.generatedMinimalPdf(
          "generated page-limit fixture",
          parsingModule.DOCUMENT_LIMITS.pages + 1,
        ),
    },
  ];
  if (definitions.length !== contractModule.DOCUMENT_PARSER_CORPUS_CASE_COUNT) {
    throw new Error("The generated corpus case count changed without a contract version change");
  }
  await mkdir(outputDirectory, { recursive: true });
  const entries = [];
  const files = [];
  const ordinals = { docx: 0, pdf: 0 };
  for (const definition of definitions) {
    const prefix = definition.mediaType === "application/pdf" ? "pdf" : "docx";
    ordinals[prefix] += 1;
    const caseId = `${prefix}-${String(ordinals[prefix]).padStart(3, "0")}`;
    const bytes = new Uint8Array(await definition.generate());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let rejection;
    const originalWarn = console.warn;
    try {
      console.warn = () => {};
      await parsingModule.parseResume({
        documentId: deterministicUuid(runId, caseId),
        documentVersion: 1,
        parserVersion: "resume-parser-v1",
        mediaType: definition.mediaType,
        sourceSha256: sha256,
        createdAt: "2026-08-26T00:00:00.000Z",
        bytes: new Uint8Array(bytes),
      });
    } catch (error) {
      rejection = error;
    } finally {
      console.warn = originalWarn;
    }
    if (
      !rejection ||
      (rejection.failureCode !== "invalid_document" && rejection.failureCode !== "parse_failed") ||
      rejection.reasonCode !== definition.reasonCode
    ) {
      throw new Error(`Generated corpus case ${caseId} did not produce its exact rejection`);
    }
    const filePath = path.join(outputDirectory, `${caseId}.${prefix === "pdf" ? "pdf" : "docx"}`);
    await writeFile(filePath, bytes, { flag: "wx" });
    entries.push({
      caseId,
      documentId: deterministicUuid(runId, caseId),
      mediaType: definition.mediaType,
      sizeBytes: bytes.byteLength,
      sha256,
      expectedFailureCode: rejection.failureCode,
      expectedReasonCode: rejection.reasonCode,
    });
    files.push({ caseId, path: filePath });
  }
  entries.sort((left, right) => left.caseId.localeCompare(right.caseId));
  files.sort((left, right) => left.caseId.localeCompare(right.caseId));
  const corpusSha256 = contractModule.documentParserCorpusSha256(entries);
  await writeFile(
    path.join(outputDirectory, "descriptor.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "development-document-parser-adversarial-corpus",
      corpusVersion: contractModule.DOCUMENT_PARSER_CORPUS_VERSION,
      runId,
      corpusSha256,
      cases: entries,
      files,
    }),
    { encoding: "utf8", flag: "wx" },
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Corpus generation failed"}\n`);
  process.exitCode = 1;
});
