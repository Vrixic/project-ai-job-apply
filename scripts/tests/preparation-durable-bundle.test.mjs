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
  for (const prefix of [
    "backend/services/",
    "backend/workers/",
    "packages/ai-sdk/",
    "node_modules/postgres/",
  ])
    assert.ok(
      !inputs.some((name) => name.includes(prefix)),
      `Unexpected orchestration capability: ${prefix}`,
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
