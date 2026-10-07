import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("resume owner admission contains no model, SQL client, AWS or content runtime", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["backend/workflows/dist/src/native-resume-owner-ports.js"],
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
  for (const forbidden of [
    "/postgres/",
    "/drizzle-orm/",
    "/ai-sdk/",
    "/@aws-sdk/",
    "native-resume-session.js",
    "catalog.js",
    "resume-tailoring.js",
    "render-memory.js",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Forbidden resume admission dependency: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.endsWith("jobs/dist/src/native-resume-admission.js")));
  assert.ok(
    inputs.some((name) => name.endsWith("applications/dist/src/native-resume-admission.js")),
  );
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.join(root, "package.json")),
  );
  const ports = module.exports.createNativeResumeGenerationOwnerPorts();
  const query = async () => {
    throw Error("SQL must remain unused");
  };
  await assert.rejects(ports.application({}, query), /NativeResumeAdmissionUnavailable/u);
  await assert.rejects(ports.job({}, "", query), /NativeResumeJobAdmissionUnavailable/u);
});
test("dedicated native preparation artifact excludes legacy objects, model, ECS and rendering", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["backend/workflows/dist/src/native-application-preparation-lambda.js"],
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
  for (const forbidden of [
    "/client-s3/",
    "/client-ecs/",
    "/openai/",
    "cover-letter-provider-initialize.js",
    "cover-letter-provider-invoke.js",
    "cover-letter-provider-objects.js",
    "native-cover-letter-runtime.js",
    "native-memory-session.js",
    "render-memory.js",
    "application-preparation-documents.js",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Forbidden native preparation dependency: ${forbidden}`,
    );
  assert.ok(inputs.some((name) => name.endsWith("application-preparation-native.js")));
  assert.ok(inputs.some((name) => name.endsWith("native-material-ready-store.js")));
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.join(root, "package.json")),
  );
  const handler = module.exports.createNativeApplicationPreparationLambda({
    environment: () => ({}),
  });
  const id = (n) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  const input = {
    schemaVersion: 1,
    workflowDefinitionVersion: 1,
    action: "advance",
    eventId: id(1),
    preparationId: id(2),
  };
  assert.deepEqual(
    await handler(input, {
      invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:native-preparation:9",
    }),
    {
      schemaVersion: 1,
      action: "advance",
      preparationId: id(2),
      outcome: "retryable_failure",
      errorCode: "store_unavailable",
    },
  );
  await assert.rejects(
    handler({ ...input, text: "Synthetic forbidden" }, {}),
    /ApplicationPreparationActivityInputRejected/u,
  );
});
