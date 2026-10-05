import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("isolated provider bundle excludes SQL, rendering and private persistence runtimes", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/services/documents/dist/src/cover-letter-isolated-provider-lambda.js"],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  const forbidden = inputs.filter((name) =>
    /(?:services\/profile\/|postgres@|drizzle-orm@|pdfjs-dist@|cover-letter-(?:work|response|store).*store\.js|cover-letter-store\.js|\/render\/|test-support)/u.test(
      name.replaceAll("\\", "/"),
    ),
  );
  assert.deepEqual(forbidden, []);
  assert.ok(inputs.some((name) => name.endsWith("cover-letter-provider-control-client.js")));
  assert.ok(inputs.some((name) => name.endsWith("cover-letter-response-capture-client.js")));
  assert.ok(inputs.some((name) => name.endsWith("lambda-provider-key.js")));
  for (const module of [
    "cover-letter-response-disposal-client.js",
    "cover-letter-provider-initialize.js",
    "cover-letter-provider-recovery.js",
    "cover-letter-cleanup-client.js",
    "private-documents-lambda.js",
  ])
    assert.ok(
      !inputs.some((name) => name.endsWith(module)),
      `Unexpected private capability: ${module}`,
    );
});
