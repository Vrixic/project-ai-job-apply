import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("private preparation composition emits controlled Invoke and recovery without direct model implementations", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/workflows/dist/src/application-preparation-documents.js"],
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
    "application-preparation-evidence.js",
    "cover-letter-preparation.js",
    "cover-letter-draft-recovery.js",
    "cover-letter-provider-initialize.js",
    "cover-letter-provider-recovery.js",
  ])
    assert.ok(
      inputs.some((name) => name.endsWith(module)),
      `Missing controlled private capability: ${module}`,
    );
  for (const module of [
    "openai.js",
    "openai-background.js",
    "openai-response-cleanup.js",
    "gateway.js",
    "testing.js",
    "cover-letter-generation.js",
    "cover-letter-isolated-provider-lambda.js",
    "cover-letter-provider-handler.js",
    "lambda-provider-key.js",
    "cover-letter-response-maintenance-lambda.js",
  ])
    assert.ok(
      !inputs.some((name) => name.endsWith(module)),
      `Unexpected model/internet capability: ${module}`,
    );
});
