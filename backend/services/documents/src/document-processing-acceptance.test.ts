import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRMATION,
  parseDocumentProcessingAcceptanceEnvironment,
  toPrivacySafeDocumentProcessingAcceptanceResult,
} from "./document-processing-acceptance.js";
import { documentProcessingAcceptanceFixtureSetSha256 } from "./document-processing-acceptance-manifest.js";

const runId = "abcdef01-abcd-4abc-8abc-abcdef012345";
const compact = runId.replaceAll("-", "");
const fixtureManifest = [
  {
    fixture: "clean-pdf" as const,
    fileName: `generated-${compact}-clean.pdf`,
    mediaType: "application/pdf" as const,
    sizeBytes: 101,
    sha256: "1".repeat(64),
  },
  {
    fixture: "clean-docx" as const,
    fileName: `generated-${compact}-clean.docx`,
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
    sizeBytes: 102,
    sha256: "2".repeat(64),
  },
  {
    fixture: "invalid-pdf" as const,
    fileName: `generated-${compact}-invalid.pdf`,
    mediaType: "application/pdf" as const,
    sizeBytes: 103,
    sha256: "3".repeat(64),
  },
  {
    fixture: "malware-test" as const,
    fileName: `generated-${compact}-malware-test.pdf`,
    mediaType: "application/pdf" as const,
    sizeBytes: 104,
    sha256: "4".repeat(64),
  },
];
const fixtureSetSha256 = documentProcessingAcceptanceFixtureSetSha256(fixtureManifest);
const fixtureManifestText = JSON.stringify(fixtureManifest);
const issuer = "https://acceptance.invalid/";

describe("document-processing acceptance environment", () => {
  it("omits the generated run identifier from the task log result", () => {
    const result = toPrivacySafeDocumentProcessingAcceptanceResult({
      schemaVersion: 1,
      kind: "development-document-processing-acceptance",
      action: "clean",
      runId,
      documentCount: 2,
      parsedCount: 2,
      rejectedCount: 0,
      failedCount: 0,
      securityHoldCount: 0,
      receiptCount: 2,
      dispositionCount: 2,
      profileFactCount: 3,
      profileVersionCount: 3,
      evidenceCount: 3,
      persistentRows: 30,
      rollbackProved: false,
      canonicalSha256: "5".repeat(64),
    });

    expect(result).not.toHaveProperty("runId");
    expect(result).toMatchObject({
      action: "clean",
      documentCount: 2,
      canonicalSha256: "5".repeat(64),
    });
  });

  it("accepts every exact lifecycle action", () => {
    for (const action of [
      "preflight",
      "clean",
      "reviewed",
      "terminal",
      "contradiction",
      "rollback-probe",
      "cleanup",
    ]) {
      expect(
        parseDocumentProcessingAcceptanceEnvironment({
          DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM: DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRMATION,
          DOCUMENT_PROCESSING_ACCEPTANCE_ACTION: action,
          DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID: runId,
          DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER: issuer,
          DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256: fixtureSetSha256,
          DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST: fixtureManifestText,
        }),
      ).toEqual({ action, runId, issuer, fixtureSetSha256, fixtureManifest });
    }
  });

  it("fails closed on confirmation, action, identifier, or digest drift", () => {
    const valid = {
      DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM: DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRMATION,
      DOCUMENT_PROCESSING_ACCEPTANCE_ACTION: "preflight",
      DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID: runId,
      DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER: issuer,
      DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256: fixtureSetSha256,
      DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST: fixtureManifestText,
    };
    for (const environment of [
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM: "true" },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_ACTION: "prepare" },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID: runId.toUpperCase() },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER: "http://acceptance.invalid/" },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER: "https://acceptance.invalid/?x=1" },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256: "A".repeat(64) },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256: undefined },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST: "[]" },
      { ...valid, DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST: "x".repeat(4097) },
    ]) {
      expect(() => parseDocumentProcessingAcceptanceEnvironment(environment)).toThrow();
    }
  });
});
