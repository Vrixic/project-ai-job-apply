import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-material-launch-lambda";
const flagName = "NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/native-launch-lambda"),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env[flagName];
    const saved = globalThis.fetch;
    let effects = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      effects++;
      throw Error("SyntheticLauncherNetworkDenied");
    };
    const id = (n) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    const input = {
      schemaVersion: 1,
      action: "launch",
      ownerUserId: id(1),
      applicationId: id(2),
      original: {
        id: id(3),
        documentId: id(4),
        purpose: "provider_dispatch",
        requestSha256: "a".repeat(64),
      },
      previousEpochId: null,
    };
    const recover = {
      schemaVersion: 1,
      action: "recover",
      scope: {
        allocationId: id(5),
        ownerUserId: id(1),
        applicationId: id(2),
        generationId: id(4),
        epochId: id(6),
      },
      taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"b".repeat(32)}`,
    };
    const context = {
      invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:private-native-launch:9",
    };
    try {
      for (const request of [input, recover])
        assert.deepEqual(await bundle.handler(request, context), {
          schemaVersion: 1,
          request,
          outcome: "unavailable",
          capture: null,
        });
      await assert.rejects(
        bundle.handler({ ...input, text: "synthetic forbidden" }, context),
        /NativeLaunchControlUnavailable/u,
      );
      assert.equal(effects, 0);
    } finally {
      globalThis.fetch = saved;
      if (flag === undefined) delete process.env[flagName];
      else process.env[flagName] = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
