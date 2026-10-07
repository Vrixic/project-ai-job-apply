import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-resume-task-observer-lambda";
const flagName = "NATIVE_RESUME_TASK_OBSERVER_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/native-resume-lambda"),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env[flagName];
    const fetch = globalThis.fetch;
    let effects = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      effects++;
      throw Error("SyntheticObserverNetworkDenied");
    };
    const id = (n) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    const input = {
      schemaVersion: 1,
      action: "observe",
      scope: {
        ownerUserId: id(1),
        applicationId: id(2),
        generationId: id(3),
        allocationId: id(4),
        epochId: id(5),
      },
    };
    const context = {
      invokedFunctionArn:
        "arn:aws:lambda:us-east-2:123456789012:function:private-resume-observer:9",
    };
    try {
      for (const request of [
        input,
        { schemaVersion: 1, action: "sweep" },
        { ...input, taskArn: "forbidden" },
        { ...input, receipt: {} },
      ])
        await assert.rejects(
          bundle.handler(request, context),
          /NativeResumeTaskObserverUnavailable/u,
        );
      assert.equal(effects, 0);
    } finally {
      globalThis.fetch = fetch;
      if (flag === undefined) delete process.env[flagName];
      else process.env[flagName] = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
