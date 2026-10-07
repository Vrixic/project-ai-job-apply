import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "privileged-moderation-audit-retention-lambda";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/services/profile/dist/src/${artifactName}.js`),
  outputDirectory: path.join(
    repositoryRoot,
    "backend/services/profile/dist/audit-retention-lambda",
  ),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/profile-service...",
  verifyBundle: async (bundle) => {
    const flagName = "PRIVILEGED_MODERATION_AUDIT_RETENTION_ENABLED";
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
        /^Error: PrivilegedModerationAuditRetentionUnavailable$/u,
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
