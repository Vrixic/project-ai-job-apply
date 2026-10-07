import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-application-preparation-lambda";
const flagName = "NATIVE_APPLICATION_PREPARATION_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/native-preparation-lambda"),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env[flagName],
      savedFetch = globalThis.fetch;
    let effects = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      effects++;
      throw Error("SyntheticNativePreparationNetworkDenied");
    };
    const id = (n) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    const input = {
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      eventId: id(1),
      preparationId: id(2),
      action: "advance",
    };
    const context = {
      invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:native-preparation:9",
    };
    try {
      assert.deepEqual(await bundle.handler(input, context), {
        schemaVersion: 1,
        action: "advance",
        preparationId: id(2),
        outcome: "retryable_failure",
        errorCode: "store_unavailable",
      });
      await assert.rejects(
        bundle.handler({ ...input, body: "Synthetic forbidden" }, context),
        /ApplicationPreparationActivityInputRejected/u,
      );
      assert.equal(effects, 0);
    } finally {
      globalThis.fetch = savedFetch;
      if (flag === undefined) delete process.env[flagName];
      else process.env[flagName] = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
