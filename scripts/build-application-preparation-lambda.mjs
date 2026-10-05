import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "application-preparation-lambda";
const flagName = "APPLICATION_PREPARATION_ACTIVITY_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/preparation-lambda"),
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env[flagName];
    const transport = globalThis.fetch;
    let fetchCalls = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      fetchCalls++;
      throw Error("SyntheticUnexpectedPreparationBootstrapFetch");
    };
    const input = {
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      eventId: "019a4000-0000-7000-8000-000000000001",
      preparationId: "019a4000-0000-7000-8000-000000000002",
      action: "advance",
    };
    const context = {
      invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-private:9",
    };
    try {
      assert.deepEqual(await bundle.handler(input, context), {
        schemaVersion: 1,
        preparationId: input.preparationId,
        action: "advance",
        outcome: "retryable_failure",
        errorCode: "store_unavailable",
      });
      await assert.rejects(
        () => bundle.handler({ ...input, text: "synthetic-forbidden-content" }, context),
        { message: "ApplicationPreparationActivityInputRejected" },
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
