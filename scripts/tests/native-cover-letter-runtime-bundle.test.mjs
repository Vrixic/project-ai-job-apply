import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("local actual-image proof rejects missing opt-in, mutable tags and malformed source before Docker", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const valid = [
    "--enable-local-image-tests",
    "--image",
    digest,
    "--certificate-image",
    digest,
    "--source-sha",
    "b".repeat(40),
  ];
  for (const args of [
    [],
    valid.slice(1),
    valid.map((value, i) => (i === 2 ? "latest" : value)),
    valid.map((value, i) => (i === 6 ? "main" : value)),
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/verify-native-material-image.mjs"), ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NativeImageProofTargetRejected/u);
    assert.equal(result.stdout, "");
  }
});
test("native image contains actual provider and pinned-secret clients without owner persistence or task authority", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["backend/services/documents/dist/src/native-image-runtime.js"],
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
  for (const forbidden of [
    "postgres",
    "client-s3",
    "client-ecs",
    "client-kms",
    "backend/workflows",
    "backend/services/profile",
    "backend/services/applications",
    "backend/services/jobs",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected image authority: ${forbidden}`,
    );
  for (const required of [
    "client-secrets-manager",
    "native-task-bootstrap.js",
    "native-owner-rpc-client.js",
    "openai.js",
    "native-memory-transport.js",
    "render/render.js",
    "pdfjs-dist",
  ])
    assert.ok(
      inputs.some((name) => name.includes(required)),
      `Missing real image component: ${required}`,
    );
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.join(root, "package.json")),
  );
  let effects = 0;
  await assert.rejects(
    module.exports.startNativeImage({
      configuration: {},
      loadKernel: () => {
        effects++;
      },
    }),
    /^Error: NativeImageConfigurationUnavailable$/u,
  );
  assert.equal(effects, 0);
});
test("native content composition emits real render/control/HTTPS without persistent or task authority", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["backend/services/documents/dist/src/native-cover-letter-runtime.js"],
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
  for (const forbidden of [
    "postgres",
    "client-s3",
    "client-ecs",
    "client-kms",
    "client-secrets-manager",
    "cover-letter-objects",
    "cover-letter-store",
    "native-material-registry.js",
    "native-task-launch.js",
    "native-task-retirement.js",
    "backend/workflows",
    "backend/services/profile",
    "backend/services/applications",
    "backend/services/jobs",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected native content authority: ${forbidden}`,
    );
  for (const required of [
    "native-cover-letter-runtime.js",
    "native-memory-session.js",
    "native-memory-transport.js",
    "native-material-controls.js",
    "original-cover-letter-generation.js",
    "render/verify.js",
    "render/render.js",
    "parsing/pdf.js",
    "@aws-sdk/client-lambda",
    "pdfjs-dist",
    "yazl",
  ])
    assert.ok(
      inputs.some((name) => name.includes(required)),
      `Missing actual runtime component: ${required}`,
    );
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.join(root, "package.json")),
  );
  let effects = 0;
  const options = Object.defineProperty({}, "binding", {
    get() {
      effects++;
      throw Error("UnexpectedNativeContent");
    },
  });
  await assert.rejects(
    module.exports.createNativeCoverLetterRuntime(options),
    /^Error: NativeCoverLetterRuntimeUnavailable$/u,
  );
  assert.equal(effects, 0);
});

test("native task bootstrap connects self metadata and signed approval without owning SQL or task control", async () => {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["backend/services/documents/dist/src/native-task-bootstrap.js"],
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
  for (const forbidden of [
    "postgres",
    "client-s3",
    "client-ecs",
    "client-kms",
    "client-secrets-manager",
    "native-material-registry.js",
    "native-task-launch.js",
    "native-task-retirement.js",
    "backend/workflows",
    "backend/services/profile",
    "backend/services/applications",
    "backend/services/jobs",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(forbidden)),
      `Unexpected bootstrap capability: ${forbidden}`,
    );
  for (const required of [
    "native-task-bootstrap.js",
    "native-task-metadata.js",
    "native-owner-rpc-client.js",
    "native-owner-evidence-client.js",
    "native-task-caller-client.js",
    "native-cover-letter-runtime.js",
  ])
    assert.ok(
      inputs.some((name) => name.includes(required)),
      `Missing bootstrap source: ${required}`,
    );
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(path.join(root, "package.json")),
  );
  let effects = 0;
  const options = Object.defineProperty({}, "deployment", {
    get() {
      effects++;
      throw Error("UnexpectedBootstrap");
    },
  });
  await assert.rejects(
    module.exports.startNativeMaterialTask(options),
    /^Error: NativeTaskBootstrapUnavailable$/u,
  );
  assert.equal(effects, 0);
});
