import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "job-retention-lambda";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/job-retention-lambda"),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flagName = "JOB_RETENTION_ENABLED";
    const previous = process.env[flagName];
    const savedFetch = globalThis.fetch;
    let effects = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      effects++;
      throw Error("SyntheticAuditNetworkDenied");
    };
    try {
      await assert.rejects(
        bundle.handler(
          { schemaVersion: 1, action: "expire" },
          { invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:audit:9" },
        ),
        /^Error: JobRetentionUnavailable$/u,
      );
      assert.equal(effects, 0);
    } finally {
      globalThis.fetch = savedFetch;
      if (previous === undefined) delete process.env[flagName];
      else process.env[flagName] = previous;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
