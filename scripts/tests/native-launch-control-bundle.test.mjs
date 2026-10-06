import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
  taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
};
const target = "arn:aws:lambda:us-east-2:123456789012:function:private-native-launch:9";
async function emitted(entry) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    write: false,
    metafile: true,
  });
  const inputs = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, item]) => item.bytesInOutput > 0)
      .map(([name]) => name.replaceAll("\\", "/")),
  );
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.join(root, "package.json")),
  );
  return { inputs, bundle: module.exports };
}
test("emitted launcher supplies only owning admission/registry/ECS/managed-secret capabilities", async () => {
  const { inputs, bundle } = await emitted(
    "backend/workflows/dist/src/native-material-launch-lambda.js",
  );
  assert.deepEqual(
    inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
    [
      "backend/services/applications/dist/src/database.js",
      "backend/services/applications/dist/src/native-material-admission.js",
      "backend/services/documents/dist/src/native-launch-control-contract.js",
      "backend/services/documents/dist/src/native-material-registry.js",
      "backend/services/documents/dist/src/native-task-allocation.js",
      "backend/services/documents/dist/src/native-task-launch.js",
      "backend/services/profile/dist/src/lambda-database-url.js",
      "backend/workflows/dist/src/native-material-launch-lambda.js",
    ].sort(),
  );
  for (const forbidden of [
    "ai-sdk",
    "client-lambda",
    "client-s3",
    "client-kms",
    "client-secrets-manager",
    "pdfjs",
    "yazl",
    "drizzle",
    "packet",
    "event-contracts",
    "durable-execution",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected launcher capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-ecs")));
  assert.ok(inputs.some((name) => name.includes("postgres")));
  let effects = 0;
  const handler = bundle.createNativeMaterialLaunchLambda({
    environment: () => ({}),
    resolveDatabaseUrl: async () => {
      effects++;
      throw Error("SyntheticSecretDenied");
    },
    createRuntime: () => {
      effects++;
      throw Error("SyntheticSqlDenied");
    },
  });
  for (const request of [input, recover])
    assert.deepEqual(await handler(request, { invokedFunctionArn: target }), {
      schemaVersion: 1,
      request,
      outcome: "unavailable",
      capture: null,
    });
  await assert.rejects(
    handler({ ...input, content: "synthetic forbidden" }, { invokedFunctionArn: target }),
    /NativeLaunchControlUnavailable/u,
  );
  assert.equal(effects, 0);
});
test("emitted native sender supplies only Lambda and pure strict metadata validation", async () => {
  const { inputs, bundle } = await emitted(
    "backend/services/documents/dist/src/native-launch-control.js",
  );
  assert.deepEqual(
    inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
    [
      "backend/services/documents/dist/src/native-launch-control.js",
      "backend/services/documents/dist/src/native-launch-control-client.js",
      "backend/services/documents/dist/src/native-launch-control-contract.js",
      "backend/services/documents/dist/src/native-task-allocation.js",
    ].sort(),
  );
  for (const forbidden of [
    "postgres",
    "client-ecs",
    "client-s3",
    "client-kms",
    "client-secrets-manager",
    "ai-sdk",
    "pdfjs",
    "yazl",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected sender capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-lambda")));
  const saved = globalThis.fetch;
  let effects = 0;
  globalThis.fetch = async () => {
    effects++;
    throw Error("SyntheticNetworkDenied");
  };
  try {
    const client = bundle.createNativeLaunchControlClient({ functionArn: target });
    assert.ok(Object.isFrozen(client));
    assert.deepEqual(Object.keys(client), ["launch", "recover"]);
    await assert.rejects(client.launch(input), /NativeLaunchControlUnavailable/u);
    await assert.rejects(client.recover(recover), /NativeLaunchControlUnavailable/u);
    assert.equal(effects, 0);
  } finally {
    globalThis.fetch = saved;
  }
});
