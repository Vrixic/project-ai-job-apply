import assert from "node:assert/strict";

const documentId = "019a4000-0000-7000-8000-000000000001";
const reference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId,
  purpose: "provider_dispatch",
  requestSha256: "a".repeat(64),
};

export const privateDocumentArtifacts = Object.freeze([
  Object.freeze({
    name: "cover-letter-provider-control-lambda",
    flag: "COVER_LETTER_PROVIDER_CONTROL_ENABLED",
    error: "CoverLetterProviderControlUnavailable",
    input: Object.freeze({
      schemaVersion: 1,
      action: "claim",
      documentId,
      requestSha256: reference.requestSha256,
      consentExpiresAt: "2026-10-03T23:00:00.000Z",
    }),
    unavailable: Object.freeze({
      schemaVersion: 1,
      action: "claim",
      documentId,
      outcome: "unavailable",
    }),
  }),
  Object.freeze({
    name: "cover-letter-response-capture-lambda",
    flag: "COVER_LETTER_RESPONSE_CAPTURE_ENABLED",
    error: "CoverLetterResponseCaptureUnavailable",
    input: Object.freeze({
      schemaVersion: 1,
      action: "reserve",
      reference: Object.freeze(reference),
    }),
    unavailable: Object.freeze({
      schemaVersion: 1,
      action: "reserve",
      reference,
      outcome: "unavailable",
    }),
  }),
  Object.freeze({
    name: "cover-letter-cleanup-lambda",
    flag: "COVER_LETTER_CLEANUP_CONTROL_ENABLED",
    error: "CoverLetterCleanupUnavailable",
    input: Object.freeze({ schemaVersion: 1, action: "fence", documentId, reference }),
    unavailable: Object.freeze({
      schemaVersion: 1,
      action: "fence",
      documentId,
      reference,
      outcome: "unavailable",
    }),
  }),
]);

// The real bundled handler must refuse without secret transport. This is not live IAM proof.
export async function verifyPrivateDocumentBundle(bundleModule, artifact) {
  assert.ok(privateDocumentArtifacts.includes(artifact), "Unknown private artifact");
  const previousFlag = process.env[artifact.flag];
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  process.env[artifact.flag] = "false";
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("SyntheticUnexpectedPrivateArtifactFetch");
  };
  try {
    const input = structuredClone(artifact.input);
    const context = {
      invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic:3",
    };
    assert.deepEqual(await bundleModule.handler(input, context), artifact.unavailable);
    await assert.rejects(
      () => bundleModule.handler({ ...input, content: "synthetic-forbidden-content" }, context),
      (error) => error instanceof Error && error.message === artifact.error,
    );
    assert.equal(fetchCalls, 0, "Private bundle attempted secret transport while disabled");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousFlag === undefined) delete process.env[artifact.flag];
    else process.env[artifact.flag] = previousFlag;
  }
}
