import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const entry of [
  "temporary-material-completion-lambda",
  "temporary-material-completion-client",
])
  test(`${entry} emits metadata control without generated content or writer capabilities`, async () => {
    const result = await build({
      absWorkingDir: repositoryRoot,
      entryPoints: [`backend/services/documents/dist/src/${entry}.js`],
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
    for (const module of [
      "temporary-material-reference.js",
      "temporary-material-completion-contract.js",
    ])
      assert.ok(
        inputs.some((name) => name.endsWith(module)),
        `Missing scalar contract: ${module}`,
      );
    for (const module of [
      "temporary-materials.js",
      "temporary-cover-letter.js",
      "cover-letter.js",
      "cover-letter-work-store.js",
      "cover-letter-store.js",
      "cover-letter-objects.js",
      "cover-letter-provider-handler.js",
      "cover-letter-generation.js",
      "openai.js",
      "gateway.js",
      "openai-background.js",
      "openai-response-cleanup.js",
      "lambda-provider-key.js",
    ])
      assert.ok(
        !inputs.some((name) => name.endsWith(module)),
        `Unexpected content/writer capability: ${module}`,
      );
    assert.deepEqual(
      inputs.filter((name) => /(?:client-s3@|pdfjs-dist@|\/render\/)/u.test(name)),
      [],
    );
    if (entry.endsWith("-client")) {
      assert.deepEqual(
        inputs.filter((name) => /(?:postgres@|services\/profile\/)/u.test(name)),
        [],
      );
      assert.ok(!inputs.some((name) => name.endsWith("temporary-material-completion-store.js")));
    } else
      assert.ok(inputs.some((name) => name.endsWith("temporary-material-completion-store.js")));
  });
