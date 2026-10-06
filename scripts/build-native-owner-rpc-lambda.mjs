import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-owner-rpc-lambda";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/native-owner-rpc-lambda"),
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env.NATIVE_OWNER_RPC_ENABLED;
    const fetcher = globalThis.fetch;
    let effects = 0;
    process.env.NATIVE_OWNER_RPC_ENABLED = "false";
    globalThis.fetch = async () => {
      effects++;
      throw Error("SyntheticOwnerRpcNetworkDenied");
    };
    try {
      for (const request of [
        {},
        { schemaVersion: 1, action: "claim" },
        { schemaVersion: 1, proof: "synthetic forbidden" },
      ])
        await assert.rejects(
          bundle.handler(request, {
            invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:native-owner:7",
          }),
          /^Error: NativeOwnerRpcUnavailable$/u,
        );
      assert.equal(effects, 0);
    } finally {
      globalThis.fetch = fetcher;
      if (flag === undefined) delete process.env.NATIVE_OWNER_RPC_ENABLED;
      else process.env.NATIVE_OWNER_RPC_ENABLED = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
