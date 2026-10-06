import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-material-task-event-lambda";
const flagName = "NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/native-task-event-lambda"),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env[flagName];
    const fetch = globalThis.fetch;
    let effects = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      effects++;
      throw Error("SyntheticEventNetworkDenied");
    };
    try {
      await assert.rejects(
        bundle.handler({ source: "aws.ecs" }, { invokedFunctionArn: "synthetic" }),
        /^Error: NativeMaterialTaskEventUnavailable$/u,
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
