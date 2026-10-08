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
test("emitted native material controls expose only bound original scalar work/completion/readiness", async () => {
  const { inputs, bundle } = await emitted(
    "backend/services/documents/dist/src/native-material-controls.js",
  );
  assert.deepEqual(
    inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
    [
      "backend/services/documents/dist/src/native-material-controls.js",
      "backend/services/documents/dist/src/native-material-ready.js",
      "backend/services/documents/dist/src/native-evidence-binding.js",
      "backend/services/documents/dist/src/native-owner-rpc-client.js",
      "backend/services/documents/dist/src/native-owner-rpc-contract.js",
      "backend/services/documents/dist/src/native-owner-rpc-transport.js",
      "backend/services/documents/dist/src/native-task-caller-client.js",
      "backend/services/documents/dist/src/native-task-caller-client-core.js",
      "backend/services/documents/dist/src/native-task-caller-contract.js",
      "backend/services/documents/dist/src/native-task-credentials.js",
      "backend/services/documents/dist/src/native-task-allocation.js",
      "backend/services/documents/dist/src/native-launch-control-contract.js",
      "packages/domain/dist/temporary-material.js",
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
    "durable-execution",
    "event-contracts",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected native material control capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-lambda")));
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-sts")));
  const ports = bundle.createNativeMaterialControls({
    allocation: {
      allocationId: recover.scope.allocationId,
      ownerUserId: recover.scope.ownerUserId,
      applicationId: recover.scope.applicationId,
      generationId: recover.scope.generationId,
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
      taskArn: recover.taskArn,
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
      containerName: "material",
    },
    original: { ...input.original },
    consentExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    workFunctionArn: target,
    completionFunctionArn: target.replace("private-native-launch", "private-original-completion"),
  });
  assert.deepEqual(Object.keys(ports), ["publishReady", "work", "completion"]);
  await assert.rejects(ports.publishReady({}), /NativeMaterialControlsUnavailable/u);
  assert.deepEqual(
    await ports.work.claimProviderDispatch({
      documentId: input.original.documentId,
      requestSha256: input.original.requestSha256,
      consentExpiresAt: new Date(),
    }),
    { kind: "unavailable" },
  );
});
test("emitted native task event receiver carries only scalar Lambda recovery capability", async () => {
  const { inputs, bundle } = await emitted(
    "backend/workflows/dist/src/native-material-task-event-lambda.js",
  );
  assert.deepEqual(
    inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
    [
      "backend/services/documents/dist/src/native-launch-control-client.js",
      "backend/services/documents/dist/src/native-launch-control-contract.js",
      "backend/services/documents/dist/src/native-task-allocation.js",
      "backend/workflows/dist/src/native-material-task-event-lambda.js",
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
    "durable-execution",
    "event-contracts",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected task event capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-lambda")));
  await assert.rejects(
    bundle.createNativeMaterialTaskEventLambda({ environment: () => ({}) })(
      { source: "aws.ecs" },
      { invokedFunctionArn: target },
    ),
    /NativeMaterialTaskEventUnavailable/u,
  );
});
test("emitted launcher supplies owning admission and read-only route inspection without DNS mutation", async () => {
  const { inputs, bundle } = await emitted(
    "backend/workflows/dist/src/native-material-launch-lambda.js",
  );
  assert.deepEqual(
    inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
    [
      "backend/services/applications/dist/src/database.js",
      "backend/services/applications/dist/src/native-material-admission.js",
      "backend/services/documents/dist/src/native-evidence-binding.js",
      "backend/services/documents/dist/src/native-launch-control-contract.js",
      "backend/services/documents/dist/src/native-material-registry.js",
      "backend/services/documents/dist/src/native-task-allocation.js",
      "backend/services/documents/dist/src/native-task-launch.js",
      "backend/services/documents/dist/src/native-task-launch-policy.js",
      "backend/services/profile/dist/src/lambda-database-url.js",
      "backend/workflows/dist/src/native-material-launch-lambda.js",
      "backend/workflows/dist/src/native-material-control-configuration.js",
      "backend/workflows/dist/src/native-material-route-control-lambda.js",
      "backend/workflows/dist/src/native-material-route-owner.js",
      "backend/services/documents/dist/src/native-material-route-control-contract.js",
      "backend/services/documents/dist/src/native-material-task-address.js",
      "backend/services/documents/dist/src/native-task-address.js",
      "backend/services/documents/dist/src/native-material-location-store.js",
      "backend/services/documents/dist/src/native-resume-route-policy.js",
      "backend/services/documents/dist/src/native-owner-rpc-contract.js",
      "packages/domain/dist/temporary-material.js",
    ].sort(),
  );
  for (const forbidden of [
    "ai-sdk",
    "client-lambda",
    "client-route-53",
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
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-ec2")));
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

test("emitted resume preparation client has only scalar Lambda capability", async () => {
  const { inputs, bundle } = await emitted(
    "backend/services/documents/dist/src/native-resume-preparation-control-client.js",
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
    "durable-execution",
    "drizzle",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected preparation client capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-lambda")));
  const client = bundle.createNativeResumePreparationControlClient({ functionArn: target });
  await assert.rejects(
    client.run({ schemaVersion: 1, action: "complete", scope: recover.scope }),
    /NativeResumePreparationControlUnavailable/u,
  );
});

test("emitted private resume preparation stays off before secret, SQL or ECS work", async () => {
  const { inputs, bundle } = await emitted(
    "backend/workflows/dist/src/native-resume-preparation-control-lambda.js",
  );
  for (const forbidden of [
    "client-lambda",
    "client-s3",
    "client-kms",
    "ai-sdk",
    "pdfjs",
    "yazl",
    "durable-execution",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected preparation control capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-ecs")));
  assert.ok(inputs.some((name) => name.includes("postgres")));
  let effects = 0;
  const handler = bundle.createNativeResumePreparationControlLambda({
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
  const request = { schemaVersion: 1, action: "complete", scope: recover.scope };
  assert.deepEqual(await handler(request, { invokedFunctionArn: target }), {
    schemaVersion: 1,
    request,
    outcome: "unavailable",
    scope: null,
    packet: null,
  });
  await assert.rejects(
    handler({ ...request, content: "synthetic forbidden" }, { invokedFunctionArn: target }),
    /NativeResumePreparationControlUnavailable/u,
  );
  assert.equal(effects, 0);
});

test("emitted resume durable workflow excludes owner SQL, ECS and generated-content capabilities", async () => {
  const { inputs, bundle } = await emitted(
    "backend/workflows/dist/src/native-resume-preparation-durable-lambda.js",
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
    "drizzle",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected resume durable capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("durable-execution-sdk-js")));
  const handler = bundle.createNativeResumePreparationDurableLambda({ environment: () => ({}) });
  await assert.rejects(
    handler({}, { invokedFunctionArn: target }),
    /NativeResumePreparationWorkflowUnavailable/u,
  );
});

test("emitted resume queue dispatcher excludes content and task-launch capabilities", async () => {
  const { inputs, bundle } = await emitted(
    "backend/workflows/dist/src/native-resume-request-dispatch-lambda.js",
  );
  for (const forbidden of ["client-ecs", "client-s3", "ai-sdk", "pdfjs", "yazl"])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected resume queue capability: ${forbidden}`,
    );
  let effects = 0;
  const handler = bundle.createNativeResumeRequestDispatchLambda({
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
  await assert.rejects(
    handler({ schemaVersion: 1, action: "sweep" }, { invokedFunctionArn: target }),
    /NativeResumeDispatchUnavailable/u,
  );
  assert.equal(effects, 0);
});

test("emitted material route sender contains only scalar Lambda invocation", async () => {
  const { inputs, bundle } = await emitted(
    "backend/services/documents/dist/src/native-material-route-control-client.js",
  );
  for (const forbidden of [
    "postgres",
    "client-ecs",
    "client-ec2",
    "client-route-53",
    "client-s3",
    "client-kms",
    "ai-sdk",
    "pdfjs",
    "durable-execution",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected route sender capability: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-lambda")));
  await assert.rejects(
    bundle.createNativeMaterialRouteControlClient({ functionArn: target }).run({}),
    /NativeMaterialRouteControlUnavailable/u,
  );
});
