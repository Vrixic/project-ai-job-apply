import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-resume-source-rpc-lambda";
const flagName = "NATIVE_RESUME_SOURCE_RPC_ENABLED";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(
    repositoryRoot,
    "backend/workflows/dist/native-resume-source-rpc-lambda",
  ),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env[flagName];
    const fetcher = globalThis.fetch;
    let effects = 0;
    process.env[flagName] = "false";
    globalThis.fetch = async () => {
      effects++;
      throw Error("SyntheticResumeSourceRpcNetworkDenied");
    };
    try {
      for (const request of [
        {},
        { schemaVersion: 1, action: "claim" },
        { schemaVersion: 1, proof: "synthetic forbidden" },
      ])
        await assert.rejects(
          bundle.handler(request, {
            invokedFunctionArn:
              "arn:aws:lambda:us-east-2:123456789012:function:native-resume-source:7",
          }),
          /^Error: NativeResumeSourceUnavailable$/u,
        );
      assert.equal(effects, 0);
    } finally {
      globalThis.fetch = fetcher;
      if (flag === undefined) delete process.env[flagName];
      else process.env[flagName] = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
