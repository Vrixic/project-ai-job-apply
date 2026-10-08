import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-material-cleanup-worker-lambda";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(
    repositoryRoot,
    "backend/gateway/dist/src/native-material-cleanup-worker.js",
  ),
  outputDirectory: path.join(repositoryRoot, "backend/gateway/dist/native-cleanup-lambda"),
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/gateway...",
  verifyBundle: async (bundle) => {
    const flag = process.env.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED;
    try {
      delete process.env.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED;
      await assert.rejects(
        () =>
          bundle.handler(
            { schemaVersion: 1, action: "drain" },
            {
              invokedFunctionArn:
                "arn:aws:lambda:us-east-2:123456789012:function:synthetic-material-cleanup:9",
            },
          ),
        { message: "NativeMaterialCleanupWorkerUnavailable" },
      );
    } finally {
      if (flag === undefined) delete process.env.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED;
      else process.env.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
