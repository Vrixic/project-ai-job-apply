import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "cover-letter-response-maintenance-lambda";
const flagName = "COVER_LETTER_RESPONSE_MAINTENANCE_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, `backend/services/documents/dist/src/${artifactName}.js`),
  outputDirectory: path.join(
    repositoryRoot,
    "backend/services/documents/dist/response-maintenance-lambda",
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
      action: "reconcile_failed",
      reference: {
        id: "019a4000-0000-7000-8000-000000000002",
        documentId,
        purpose: "provider_dispatch",
        requestSha256: "a".repeat(64),
      },
    };
    const context = {
      invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider:9",
    };
    try {
      assert.deepEqual(await bundle.handler(input, context), {
        ...input,
        outcome: "unresolved",
      });
      await assert.rejects(
        () => bundle.handler({ ...input, text: "synthetic-forbidden-content" }, context),
        { message: "CoverLetterResponseMaintenanceUnavailable" },
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
