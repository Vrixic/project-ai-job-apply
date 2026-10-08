import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const id = (n) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
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
for (const side of ["client", "verifier"]) {
  test(`native caller ${side} preserves narrow authentication and default-off refusal`, async () => {
    const result = await build({
      absWorkingDir: root,
      entryPoints: [`backend/services/documents/dist/src/native-task-caller-${side}.js`],
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
    const expected = [
      "native-evidence-binding.js",
      "native-launch-control-contract.js",
      "native-task-allocation.js",
      "native-task-caller-contract.js",
      `native-task-caller-${side}.js`,
      `native-task-caller-${side}-core.js`,
      ...(side === "client" ? ["native-task-credentials.js"] : []),
    ].map((name) => `backend/services/documents/dist/src/${name}`);
    assert.deepEqual(
      inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
      expected.sort(),
    );
    for (const forbidden of [
      "postgres",
      "client-s3",
      "client-ecs",
      "client-lambda",
      "client-kms",
      "client-secrets-manager",
      "pdfjs",
      "yazl",
      "native-material-registry.js",
      "native-task-launch.js",
      "native-task-retirement.js",
      "ai-sdk",
    ])
      assert.ok(
        !inputs.some((name) => name.includes(forbidden)),
        `Unexpected caller authority: ${forbidden}`,
      );
    if (side === "client") assert.ok(inputs.some((name) => name.includes("@aws-sdk/client-sts")));
    else {
      assert.ok(inputs.some((name) => name.includes("saxes")));
      assert.ok(!inputs.some((name) => name.includes("@aws-sdk")));
    }
    const module = { exports: {} };
    new Function("module", "exports", "require", result.outputFiles[0].text)(
      module,
      module.exports,
      createRequire(path.join(root, "package.json")),
    );
    const options = {
      binding,
      targetArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-evidence:7",
      taskRoleArn: "arn:aws:iam::123456789012:role/synthetic-material",
    };
    if (side === "client") {
      const client = module.exports.createNativeTaskCallerClient(options);
      assert.deepEqual(Object.keys(client), ["proof"]);
      await assert.rejects(client.proof("c".repeat(64)), /^Error: NativeTaskCallerUnavailable$/u);
    } else {
      const verifier = module.exports.createNativeTaskCallerVerifier(options);
      assert.deepEqual(Object.keys(verifier), ["verify"]);
      await assert.rejects(
        verifier.verify({}, "c".repeat(64)),
        /^Error: NativeTaskCallerUnavailable$/u,
      );
    }
  });
}
