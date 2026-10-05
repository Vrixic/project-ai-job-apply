import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("native preparation starter emits owning dispatch and no document/provider/recovery actors", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/workflows/dist/src/application-preparation-starter-lambda.js"],
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
  for (const module of [
    "application-preparation-dispatch.js",
    "application-preparation-dispatch-aws.js",
    "lambda-database-url.js",
  ])
    assert.ok(
      inputs.some((name) => name.endsWith(module)),
      `Missing native dispatch capability: ${module}`,
    );
  assert.ok(
    inputs.some(
      (name) => name.includes("backend/services/applications/") && name.endsWith("store.js"),
    ),
  );
  for (const prefix of ["backend/services/documents/", "backend/workers/", "packages/ai-sdk/"])
    assert.ok(
      !inputs.some((name) => name.includes(prefix)),
      `Unexpected native starter capability: ${prefix}`,
    );
  for (const module of [
    "application-preparation-durable.js",
    "application-preparation-lambda.js",
    "application-preparation-documents.js",
    "application-preparation-recovery.js",
  ])
    assert.ok(
      !inputs.some((name) => name.endsWith(module)),
      `Unexpected actor capability: ${module}`,
    );
});
