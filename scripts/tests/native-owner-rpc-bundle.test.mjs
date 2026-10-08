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

const resumeBinding = {
  schemaVersion: 1,
  kind: "tailored_resume",
  scope: binding.scope,
  allocation: binding.allocation,
  configurationSha256: "f".repeat(64),
};
for (const side of ["client", "handler", "lambda"]) {
  test(`emitted resume ${side} keeps original task controls separate from content and provider work`, async () => {
    const entry =
      side === "lambda"
        ? "backend/workflows/dist/src/native-resume-owner-rpc-lambda.js"
        : `backend/services/documents/dist/src/native-resume-owner-rpc-${side}.js`;
    const { inputs, exports } = await emitted(entry);
    for (const name of [
      ...prohibited,
      "ai-sdk",
      "native-evidence-binding.js",
      "cover-letter-work-store.js",
      "native-material-registry.js",
      "native-resume-session.js",
      "native-task-launch.js",
      "native-task-retirement.js",
      ...(side !== "lambda"
        ? [
            "postgres",
            "backend/services/profile",
            "backend/services/applications",
            "backend/services/jobs",
          ]
        : []),
      ...(side !== "client" ? ["@aws-sdk"] : []),
    ])
      assert.ok(
        !inputs.some((input) => input.includes(name)),
        `Unexpected resume ${side} capability: ${name}`,
      );
    assert.ok(inputs.some((input) => input.includes("native-resume-task-binding.js")));
    if (side === "client") {
      assert.ok(inputs.some((input) => input.includes("@aws-sdk/client-sts")));
      assert.ok(inputs.some((input) => input.includes("@aws-sdk/client-lambda")));
      const client = exports.createNativeResumeOwnerRpcClient({
        binding: resumeBinding,
        targetArn: target,
      });
      await assert.rejects(client.bootstrap(), /^Error: NativeResumeOwnerUnavailable$/u);
      await assert.rejects(
        client.checkAdmission(resumeBinding),
        /^Error: NativeResumeOwnerUnavailable$/u,
      );
    } else if (side === "handler") {
      let effects = 0;
      const handler = exports.createNativeResumeOwnerRpcHandler({
        targetArn: target,
        taskRoleArn: "arn:aws:iam::123456789012:role/native-resume",
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
        handler({ schemaVersion: 1, action: "claim" }, { invokedFunctionArn: target }),
        /^Error: NativeResumeOwnerUnavailable$/u,
      );
      assert.equal(effects, 0);
    } else {
      for (const name of [
        "native-resume-generation-store.js",
        "native-resume-admission.js",
        "native-resume-owner-ports.js",
        "native-principal.js",
        "postgres",
      ])
        assert.ok(
          inputs.some((input) => input.includes(name)),
          `Missing resume owner capability: ${name}`,
        );
      let effects = 0;
      const handler = exports.createNativeResumeOwnerRpcLambda({
        environment: () => ({}),
        resolveDatabaseUrl: async () => {
          effects++;
          throw Error("UnexpectedSecret");
        },
      });
      await assert.rejects(
        handler({}, { invokedFunctionArn: target }),
        /^Error: NativeResumeOwnerUnavailable$/u,
      );
      assert.equal(effects, 0);
    }
  });
}

for (const side of ["client", "handler", "lambda"]) {
  test(`emitted resume source ${side} excludes generated-content and unrelated owner capability`, async () => {
    const { inputs, exports } = await emitted(
      side === "lambda"
        ? "backend/workflows/dist/src/native-resume-source-rpc-lambda.js"
        : `backend/services/documents/dist/src/native-resume-source-rpc-${side}.js`,
    );
    for (const name of [
      "ai-sdk",
      "render/",
      "resume-tailoring.js",
      "native-resume-session.js",
      "processor-lambda.js",
      "parser-lambda.js",
      "pdfjs",
      "yazl",
      "client-ecs",
      "native-task-launch.js",
      "native-task-retirement.js",
      "cover-letter-work-store.js",
      "native-evidence-binding.js",
      ...(side !== "lambda"
        ? [
            "postgres",
            "client-s3",
            "backend/services/profile",
            "backend/services/applications",
            "backend/services/jobs",
          ]
        : []),
      ...(side === "handler" ? ["@aws-sdk"] : []),
    ])
      assert.ok(
        !inputs.some((i) => i.includes(name)),
        `Unexpected source ${side} capability: ${name}`,
      );
    assert.ok(inputs.some((i) => i.includes("parsing/normalize.js")));
    if (side === "lambda") {
      for (const name of [
        "postgres",
        "client-s3",
        "normalized-document-reader.js",
        "parsed-resume-source.js",
        "native-resume-generation-store.js",
        "native-resume-admission.js",
      ])
        assert.ok(
          inputs.some((i) => i.includes(name)),
          `Missing source owner capability: ${name}`,
        );
      let effects = 0;
      const handler = exports.createNativeResumeSourceRpcLambda({
        environment: () => ({}),
        resolveDatabaseUrl: async () => {
          effects++;
          throw Error("SyntheticDenied");
        },
      });
      await assert.rejects(
        handler({}, { invokedFunctionArn: target }),
        /^Error: NativeResumeSourceUnavailable$/u,
      );
      assert.equal(effects, 0);
    } else if (side === "client") {
      const bootstrap = {
        identity: {
          ownerUserId: id(2),
          applicationId: id(3),
          generationId: id(4),
          version: 1,
          baseDocumentId: id(8),
          baseVersion: 1,
          baseSha256: "a".repeat(64),
          jobContextSha256: "b".repeat(64),
        },
        canonicalJobId: id(9),
        normalizedSha256: "c".repeat(64),
      };
      const client = exports.createNativeResumeSourceRpcClient({
        binding: resumeBinding,
        bootstrap,
        targetArn: target,
      });
      assert.deepEqual(Object.keys(client), ["load"]);
      await assert.rejects(
        client.load(bootstrap.identity),
        /^Error: NativeResumeSourceUnavailable$/u,
      );
    }
  });
}
