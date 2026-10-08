import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("audit expiry emits only Profile owner modules and refuses cold default-off use", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [
      "backend/services/profile/dist/src/privileged-moderation-audit-retention-lambda.js",
    ],
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
  assert.deepEqual(
    inputs.filter((name) => name.startsWith("backend/") || name.startsWith("packages/")).sort(),
    [
      "backend/services/profile/dist/src/lambda-database-url.js",
      "backend/services/profile/dist/src/privileged-moderation-audit-retention-lambda.js",
      "backend/services/profile/dist/src/privileged-moderation-audit.js",
    ],
  );
  for (const forbidden of ["@aws-sdk/", "ai-sdk", "pdfjs", "pdf-lib", "yazl", "drizzle", "auth0"])
    assert.ok(!inputs.some((name) => name.includes(forbidden)), forbidden);
  const emitted = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    emitted,
    emitted.exports,
    createRequire(path.join(repositoryRoot, "package.json")),
  );
  let effects = 0;
  const run = emitted.exports.createPrivilegedModerationAuditRetentionLambda({
    environment: () => ({}),
    resolveDatabaseUrl: async () => {
      effects++;
      throw Error("SyntheticSecretDenied");
    },
    createRuntime: () => {
      effects++;
      throw Error("SyntheticSqlDenied");
    },
  });
  await assert.rejects(
    run({ schemaVersion: 1, action: "expire" }, { invokedFunctionArn: "invalid" }),
    /^Error: PrivilegedModerationAuditRetentionUnavailable$/u,
  );
  assert.equal(effects, 0);
});
