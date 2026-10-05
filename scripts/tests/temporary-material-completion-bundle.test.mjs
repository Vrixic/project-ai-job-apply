import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
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
      "packages/domain/dist/temporary-material.js",
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

test("actual emitted completion bootstrap stays unavailable without activation and performs no setup", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["backend/services/documents/dist/src/temporary-material-completion-lambda.js"],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    write: false,
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    process,
    Buffer,
    console,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    structuredClone,
    __dirname: repositoryRoot,
  });
  let setup = 0;
  const handler = module.exports.createTemporaryMaterialCompletionLambda({
    environment: () => ({}),
    resolveDatabaseUrl: async () => {
      setup++;
      throw Error("UnexpectedSyntheticSetup");
    },
    createStore: () => {
      setup++;
      throw Error("UnexpectedSyntheticStore");
    },
  });
  const documentId = "019a4000-0000-7000-8000-000000000001";
  const input = {
    schemaVersion: 1,
    action: "claim_original_completion",
    work: {
      id: "019a4000-0000-7000-8000-000000000002",
      documentId,
      purpose: "provider_dispatch",
      requestSha256: "a".repeat(64),
    },
    material: {
      schemaVersion: 1,
      kind: "cover_letter",
      generationId: documentId,
      ownerUserId: "019a4000-0000-7000-8000-000000000003",
      applicationId: "019a4000-0000-7000-8000-000000000004",
      version: 1,
      contentSha256: "b".repeat(64),
      completedAtMs: 1_700_000_000_000,
      expiresAtMs: 1_700_001_800_000,
    },
  };
  // The bundle's strict plain-object validator needs its own realm's object prototype.
  const realmInput = runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(input))})`);
  // A second VM realm is deliberately refused; serialize through the exported factory's realm
  // by using a null-prototype scalar tree, supported by the closed contract.
  const dataOnly = (value) =>
    typeof value === "object" && value !== null
      ? Object.assign(
          Object.create(null),
          Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dataOnly(item)])),
        )
      : value;
  await assert.rejects(handler(realmInput, {}), {
    message: "TemporaryMaterialCompletionUnavailable",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await handler(dataOnly(input), {}))), {
    ...input,
    outcome: "unavailable",
  });
  assert.equal(setup, 0);
});
