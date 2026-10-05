import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("maintenance bundle includes only private maintenance clients and provider cleanup", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [
      "backend/services/documents/dist/src/cover-letter-response-maintenance-lambda.js",
    ],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    write: false,
    metafile: true,
  });
  const inputs = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, contribution]) => contribution.bytesInOutput > 0)
      .map(([name]) => name.replaceAll("\\", "/")),
  );
  // Barrel reexports are parsed even when their generation code contributes zero output bytes.
  // Inspect emitted contributions to prove the actual maintenance artifact lacks those capabilities.
  assert.deepEqual(
    inputs.filter((name) =>
      /(?:services\/profile\/|postgres@|drizzle-orm@|pdfjs-dist@|client-s3@|cover-letter-(?:work|response|store).*store\.js|cover-letter-store\.js|\/render\/|test-support)/u.test(
        name,
      ),
    ),
    [],
  );
  for (const module of [
    "cover-letter-response-disposal-client.js",
    "cover-letter-cleanup-client.js",
    "lambda-provider-key.js",
    "openai-response-cleanup.js",
  ])
    assert.ok(
      inputs.some((name) => name.endsWith(module)),
      `Missing maintenance capability: ${module}`,
    );
  for (const module of [
    "cover-letter-provider-control-client.js",
    "cover-letter-response-capture-client.js",
    "cover-letter-provider-initialize.js",
    "cover-letter-provider-recovery.js",
    "cover-letter-provider-handler.js",
    "cover-letter-isolated-provider-lambda.js",
    "private-documents-lambda.js",
    "openai.js",
    "gateway.js",
    "openai-background.js",
  ])
    assert.ok(
      !inputs.some((name) => name.endsWith(module)),
      `Unexpected generation/private capability: ${module}`,
    );
});
