import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const id = (n) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const target = "arn:aws:lambda:us-east-2:123456789012:function:native-owner:7";
const binding = {
  scope: {
    allocationId: id(1),
    ownerUserId: id(2),
    applicationId: id(3),
    generationId: id(4),
    epochId: id(5),
  },
  allocation: {
    allocationId: id(1),
    ownerUserId: id(2),
    applicationId: id(3),
    generationId: id(4),
    clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
    taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
    taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
    containerName: "material",
  },
  original: {
    id: id(6),
    documentId: id(4),
    purpose: "provider_dispatch",
    requestSha256: "b".repeat(64),
  },
};
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
  return { inputs, exports: module.exports };
}
const prohibited = [
  "client-ecs",
  "client-s3",
  "client-kms",
  "client-secrets-manager",
  "pdfjs",
  "yazl",
  "cover-letter-objects.js",
  "cover-letter-store.js",
  "render/",
  "parsing/",
  "provider-openai",
  "durable-execution",
];
test("emitted task RPC carries only fixed signing/Lambda and strict metadata", async () => {
  const { inputs, exports } = await emitted(
    "backend/services/documents/dist/src/native-owner-rpc-client.js",
  );
  for (const name of [
    ...prohibited,
    "postgres",
    "backend/workflows",
    "backend/services/profile",
    "backend/services/applications",
    "backend/services/jobs",
    "ai-sdk",
  ])
    assert.ok(
      !inputs.some((input) => input.includes(name)),
      `Unexpected task RPC capability: ${name}`,
    );
  for (const name of [
    "@aws-sdk/client-sts",
    "@aws-sdk/client-lambda",
    "native-task-credentials.js",
    "native-owner-rpc-contract.js",
  ])
    assert.ok(
      inputs.some((input) => input.includes(name)),
      `Missing actual signing/RPC source: ${name}`,
    );
  const client = exports.createNativeOwnerRpcClient({ binding, targetArn: target });
  assert.deepEqual(Object.keys(client), ["run", "principal", "bootstrap", "checkAdmission"]);
  await assert.rejects(
    client.principal("https://synthetic.invalid/"),
    /^Error: NativeOwnerRpcUnavailable$/u,
  );
  await assert.rejects(client.bootstrap(), /^Error: NativeOwnerRpcUnavailable$/u);
  await assert.rejects(client.checkAdmission(binding), /^Error: NativeOwnerRpcUnavailable$/u);
});
test("emitted receiver authenticates without owning SQL or task/provider control", async () => {
  const { inputs, exports } = await emitted(
    "backend/services/documents/dist/src/native-owner-rpc-handler.js",
  );
  for (const name of [
    ...prohibited,
    "postgres",
    "@aws-sdk",
    "backend/workflows",
    "backend/services/profile",
    "backend/services/applications",
    "backend/services/jobs",
  ])
    assert.ok(
      !inputs.some((input) => input.includes(name)),
      `Unexpected receiver capability: ${name}`,
    );
  assert.ok(inputs.some((input) => input.includes("native-task-caller-verifier.js")));
  let effects = 0;
  const handler = exports.createNativeOwnerRpcHandler({
    targetArn: target,
    taskRoleArn: "arn:aws:iam::123456789012:role/native-task",
    deployment: {
      clusterArn: binding.allocation.clusterArn,
      taskDefinitionArn: binding.allocation.taskDefinitionArn,
      containerName: binding.allocation.containerName,
    },
    owners: async () => {
      effects++;
      throw Error("UnexpectedOwner");
    },
  });
  await assert.rejects(
    handler({ schemaVersion: 1, action: "admit" }, { invokedFunctionArn: target }),
    /^Error: NativeOwnerRpcUnavailable$/u,
  );
  assert.equal(effects, 0);
});
test("emitted owning Lambda connects SQL/owner APIs while excluding provider/content/task control", async () => {
  const { inputs, exports } = await emitted(
    "backend/workflows/dist/src/native-owner-rpc-lambda.js",
  );
  for (const name of [
    ...prohibited,
    "@aws-sdk/client-lambda",
    "@aws-sdk/client-sts",
    "native-task-launch.js",
    "native-task-retirement.js",
  ])
    assert.ok(
      !inputs.some((input) => input.includes(name)),
      `Unexpected owner RPC capability: ${name}`,
    );
  for (const name of [
    "postgres",
    "native-material-registry.js",
    "native-owner-control-store.js",
    "native-task-caller-verifier.js",
    "native-material-evidence.js",
    "native-preparation-bootstrap.js",
  ])
    assert.ok(
      inputs.some((input) => input.includes(name)),
      `Missing actual owner source: ${name}`,
    );
  let effects = 0;
  const handler = exports.createNativeOwnerRpcLambda({
    environment: () => ({}),
    resolveDatabaseUrl: async () => {
      effects++;
      throw Error("UnexpectedSecret");
    },
  });
  await assert.rejects(
    handler({}, { invokedFunctionArn: target }),
    /^Error: NativeOwnerRpcUnavailable$/u,
  );
  assert.equal(effects, 0);
});
