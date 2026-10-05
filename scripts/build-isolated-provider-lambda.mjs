import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "cover-letter-isolated-provider-lambda";
const flagName = "COVER_LETTER_ISOLATED_PROVIDER_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, `backend/services/documents/dist/src/${artifactName}.js`),
  outputDirectory: path.join(
    repositoryRoot,
    "backend/services/documents/dist/isolated-provider-lambda",
  ),
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/documents-service...",
  verifyBundle: async (bundle) => {
    const flag = process.env[flagName];
    const transport = globalThis.fetch;
    let fetchCalls = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      fetchCalls++;
      throw Error("SyntheticUnexpectedProviderBootstrapFetch");
    };
    const documentId = "019a4000-0000-7000-8000-000000000001";
    const input = {
      schemaVersion: 1,
      documentId,
      request: {
        objectVersion: "synthetic-1",
        etag: '"synthetic-1"',
        sha256: "a".repeat(64),
        sizeBytes: 100,
      },
    };
    const context = {
      invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider:9",
    };
    try {
      assert.deepEqual(await bundle.handler(input, context), {
        schemaVersion: 1,
        documentId,
        outcome: "in_progress",
      });
      await assert.rejects(
        () => bundle.handler({ ...input, text: "synthetic-forbidden-content" }, context),
        { message: "CoverLetterProviderTransportRejected" },
      );
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = transport;
      if (flag === undefined) delete process.env[flagName];
      else process.env[flagName] = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
