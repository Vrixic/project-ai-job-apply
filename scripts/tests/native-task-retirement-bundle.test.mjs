import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("native launch emits only fixed ECS control and refuses both default-off effects", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/services/documents/dist/src/native-task-launch.js"],
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
  assert.deepEqual(
    inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
    [
      "backend/services/documents/dist/src/native-task-allocation.js",
      "backend/services/documents/dist/src/native-task-launch.js",
    ],
  );
  for (const forbidden of [
    "postgres",
    "client-s3",
    "client-lambda",
    "client-secrets-manager",
    "pdfjs",
    "yazl",
    "ai-sdk",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected launch dependency: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-ecs")));
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.join(repositoryRoot, "package.json")),
  );
  let effects = 0;
  const unexpected = () => {
    effects++;
    throw Error("UnexpectedBundledEffect");
  };
  const launch = module.exports.createNativeTaskLaunch({
    registry: { claimLaunch: unexpected, readLaunch: unexpected, bindTask: unexpected },
    configuration: {
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
      containerName: "materials",
      image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/synthetic-materials@sha256:${"a".repeat(64)}`,
      executionRoleArn: "arn:aws:iam::123456789012:role/synthetic-execution",
      taskRoleArn: "arn:aws:iam::123456789012:role/synthetic-materials",
      cpu: "256",
      memory: "512",
      subnets: ["subnet-12345678901234567"],
      securityGroups: ["sg-12345678901234567"],
      assignPublicIp: "ENABLED",
    },
  });
  assert.deepEqual(Object.keys(launch), ["launch", "recover"]);
  const scope = {
    allocationId: "019d04cf-1f80-7000-8000-000000000101",
    ownerUserId: "019d04cf-1f80-7000-8000-000000000102",
    applicationId: "019d04cf-1f80-7000-8000-000000000103",
    generationId: "019d04cf-1f80-7000-8000-000000000104",
    epochId: "019d04cf-1f80-7000-8000-000000000105",
  };
  await assert.rejects(launch.launch(scope), /^Error: NativeTaskLaunchUnavailable$/u);
  await assert.rejects(
    launch.recover(
      scope,
      "arn:aws:ecs:us-east-2:123456789012:task/synthetic-materials/12345678901234567890123456789012",
    ),
    /^Error: NativeTaskLaunchUnavailable$/u,
  );
  assert.equal(effects, 0);
});

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
  assert.deepEqual(owners.sort(), [
    "backend/services/documents/dist/src/native-task-allocation.js",
    "backend/services/documents/dist/src/native-task-retirement.js",
  ]);
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

for (const [entrypoint, ownerFiles, requiredSdk] of [
  [
    "native-material-registry",
    [
      "native-material-registry",
      "native-task-allocation",
      "native-evidence-binding",
      "native-launch-control-contract",
    ],
    false,
  ],
  [
    "native-material-disposal",
    ["native-material-disposal", "native-task-allocation", "native-task-retirement"],
    true,
  ],
]) {
  test(`${entrypoint} preserves owning capability isolation and bundled default-off refusal`, async () => {
    const result = await build({
      absWorkingDir: repositoryRoot,
      entryPoints: [`backend/services/documents/dist/src/${entrypoint}.js`],
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
    assert.deepEqual(
      inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
      ownerFiles.map((name) => `backend/services/documents/dist/src/${name}.js`).sort(),
    );
    for (const forbidden of [
      "postgres",
      "client-s3",
      "client-lambda",
      "client-secrets-manager",
      "pdfjs",
      "yazl",
    ])
      assert.ok(
        !inputs.some((name) => name.includes(forbidden)),
        `Unexpected dependency: ${forbidden}`,
      );
    assert.equal(
      inputs.some((name) => name.includes("@aws-sdk/client-ecs")),
      requiredSdk,
    );
    const module = { exports: {} };
    new Function("module", "exports", "require", result.outputFiles[0].text)(
      module,
      module.exports,
      createRequire(path.join(repositoryRoot, "package.json")),
    );
    const owner = "019d04cf-1f80-7000-8000-000000000102";
    const application = "019d04cf-1f80-7000-8000-000000000103";
    const unexpected = () => {
      throw Error("UnexpectedBundledEffect");
    };
    if (entrypoint === "native-material-registry") {
      const registry = new module.exports.PostgresNativeMaterialRegistry({ begin: unexpected });
      await assert.rejects(
        registry.sealApplication(owner, application),
        /^Error: NativeMaterialRegistryUnavailable$/u,
      );
    } else {
      const client = module.exports.createNativeMaterialDisposal({
        registry: {
          sealApplication: unexpected,
          recordRetirement: unexpected,
          confirmApplicationDisposed: unexpected,
        },
      });
      await assert.rejects(
        client.discardApplication(owner, application),
        /^Error: NativeMaterialDisposalUnavailable$/u,
      );
    }
  });
}
