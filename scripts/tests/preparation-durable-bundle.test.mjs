import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("native preparation orchestration emits no private/provider/model implementations", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/workflows/dist/src/application-preparation-durable-lambda.js"],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    write: false,
    metafile: true,
  });
  const inputs = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, entry]) => entry.bytesInOutput > 0)
      .map(([name]) => name.replaceAll("\\", "/")),
  );
  assert.ok(inputs.some((name) => name.endsWith("application-preparation-durable.js")));
  assert.ok(inputs.some((name) => name.includes("@aws/durable-execution-sdk-js")));
  for (const prefix of ["backend/workers/", "packages/ai-sdk/", "node_modules/postgres/"])
    assert.ok(
      !inputs.some((name) => name.includes(prefix)),
      `Unexpected orchestration capability: ${prefix}`,
    );
  // Routing adds only strict metadata contracts, a numeric Lambda sender and DNS adapter.
  const documentModules = new Set([
    "native-task-allocation.js",
    "native-launch-control-contract.js",
    "native-material-route-control-client.js",
    "native-evidence-binding.js",
    "native-owner-rpc-contract.js",
    "native-resume-route-policy.js",
    "native-material-route-control-contract.js",
    "native-resume-dns-route.js",
    "native-task-launch-policy.js",
  ]);
  for (const name of inputs.filter((name) => name.includes("backend/services/"))) {
    assert.ok(
      name.startsWith("backend/services/documents/dist/src/") &&
        documentModules.has(path.basename(name)),
      `Unexpected orchestration service implementation: ${name}`,
    );
  }
  for (const capability of [
    "/client-s3/",
    "/client-ecs/",
    "/client-ec2/",
    "/client-kms/",
    "/openai/",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(capability)),
      `Unexpected orchestration capability: ${capability}`,
    );
  for (const module of [
    "application-preparation-lambda.js",
    "application-preparation-documents.js",
    "application-preparation-dispatch.js",
    "application-preparation-recovery.js",
  ])
    assert.ok(
      !inputs.some((name) => name.endsWith(module)),
      `Unexpected private runtime: ${module}`,
    );
});
