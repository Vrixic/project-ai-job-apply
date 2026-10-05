import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("cover-letter export emits owned reads without generation/provider/Invoke actors", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/services/documents/dist/src/cover-letter-export.js"],
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
  for (const module of ["cover-letter-export.js", "cover-letter-store.js", "cover-letter.js"])
    assert.ok(
      inputs.some((name) => name.endsWith(module)),
      `Missing owned export read: ${module}`,
    );
  for (const prefix of ["backend/workflows/", "backend/workers/", "packages/ai-sdk/"])
    assert.ok(
      !inputs.some((name) => name.includes(prefix)),
      `Unexpected native recovery capability: ${prefix}`,
    );
  for (const module of [
    "cover-letter-generation.js",
    "cover-letter-preparation.js",
    "cover-letter-provider-handler.js",
    "cover-letter-provider-invoke.js",
    "cover-letter-provider-initialize.js",
    "cover-letter-draft-recovery.js",
    "cover-letter-work-store.js",
    "cover-letter-response-store.js",
  ])
    assert.ok(!inputs.some((name) => name.endsWith(module)), `Unexpected export actor: ${module}`);
  const emitted = result.outputFiles.map((file) => file.text).join("\n");
  for (const actor of [
    "claimFinalDocument",
    "reserveForGeneration",
    "ModelGateway",
    "InvokeCommand",
  ])
    assert.ok(!emitted.includes(actor), `Unexpected emitted export effect: ${actor}`);
});
