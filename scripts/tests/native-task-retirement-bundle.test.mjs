import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("native retirement emits only its control owner and refuses default-off bundled use", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/services/documents/dist/src/native-task-retirement.js"],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    write: false,
    metafile: true,
  });
  const inputs = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, entry]) => entry.bytesInOutput > 0)
      .map(([name]) => name.replaceAll("\\", "/")),
  );
  const owners = inputs.filter(
    (name) => name.startsWith("backend/") || name.startsWith("packages/"),
  );
  assert.deepEqual(owners, ["backend/services/documents/dist/src/native-task-retirement.js"]);
  for (const capability of [
    "postgres",
    "client-s3",
    "client-lambda",
    "client-secrets-manager",
    "pdfjs",
    "yazl",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(capability)),
      `Unexpected control dependency: ${capability}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-ecs")));
  const module = { exports: {} };
  // Execute the actual emitted artifact with real Node built-ins; no handler/client injection.
  const execute = new Function("module", "exports", "require", result.outputFiles[0].text);
  execute(module, module.exports, createRequire(path.join(repositoryRoot, "package.json")));
  const allocation = {
    allocationId: "019d04cf-1f80-7000-8000-000000000101",
    ownerUserId: "019d04cf-1f80-7000-8000-000000000102",
    applicationId: "019d04cf-1f80-7000-8000-000000000103",
    generationId: "019d04cf-1f80-7000-8000-000000000104",
    clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
    taskArn:
      "arn:aws:ecs:us-east-2:123456789012:task/synthetic-materials/12345678901234567890123456789012",
    taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
    containerName: "materials",
  };
  const client = module.exports.createNativeTaskRetirement({ allocation });
  assert.deepEqual(Object.keys(client), ["retire"]);
  await assert.rejects(client.retire(allocation), /^Error: NativeTaskRetirementUnavailable$/u);
});
