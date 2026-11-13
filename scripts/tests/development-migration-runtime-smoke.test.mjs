import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const publisher = readFileSync(
  join(repositoryRoot, "scripts/publish-development-migration-image.ps1"),
  "utf8",
);
const scripts = [...publisher.matchAll(/\$smokeScript = @'\r?\n([\s\S]*?)\r?\n'@/gu)];
assert.equal(scripts.length, 1, "exactly one production runtime smoke must exist");
const smoke = scripts[0][1];
const manifest = JSON.parse(
  readFileSync(
    join(repositoryRoot, "backend/services/database-migrations/restore-manifest.v1.json"),
    "utf8",
  ),
);
const owners = [
  "profile",
  "jobs",
  "documents",
  "matching",
  "billing",
  "trust",
  "applications",
  "notifications",
];
const migrations = manifest.contributors.flatMap((contributor) =>
  contributor.migrations.map((migration) => ({
    owner: contributor.owner,
    version: migration.version,
    relative: `${contributor.owner}/migrations/${migration.version}.sql`,
  })),
);
assert.equal(migrations.length, 90);
assert.deepEqual(manifest.contributors.map((x) => x.owner).sort(), [...owners].sort());

function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), "migration-runtime-smoke-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (relative, data) => {
    const destination = join(root, relative);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, data);
  };
  const copy = (source, relative) => {
    const destination = join(root, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repositoryRoot, source), destination);
  };
  write("package.json", '{"type":"module"}');
  write("runner/restore-manifest.v1.json", JSON.stringify(manifest));
  // Node 24 strips types from these unchanged real modules; no database runner is executed.
  copy("backend/services/database-migrations/src/index.ts", "runner/dist/src/runners.ts");
  write("runner/dist/src/index.js", 'export {migrationRunners} from "./runners.ts";');
  copy(
    "backend/services/database-migrations/src/restore-verifier.ts",
    "runner/dist/src/restore-verifier.ts",
  );
  write(
    "runner/dist/src/restore-verifier.js",
    'export {loadCurrentRestoreManifest} from "./restore-verifier.ts";',
  );
  for (const migration of migrations) {
    copy(`backend/services/${migration.relative}`, migration.relative);
  }
  for (const owner of owners) write(`${owner}/dist/src/migrate.js`, "");
  for (const relative of [
    "profile/dist/src/run-private-feature-acceptance.js",
    "jobs/dist/src/search-acceptance.js",
    "jobs/dist/src/run-search-acceptance.js",
    "documents/dist/src/run-document-processing-acceptance.js",
    "matching/dist/src/run-private-feature-acceptance.js",
    "runner/dist/src/restore-verifier-cli.js",
    "applications/dist/src/run-legacy-receipt-transition.js",
  ]) {
    write(relative, "");
  }
  // Only module resolution is exercised, not a mocked or live SQL connection.
  for (const owner of ["profile", "billing", "trust", "notifications"]) {
    write(`${owner}/package.json`, '{"type":"module"}');
    write(`${owner}/node_modules/postgres/index.js`, "");
  }
  const run = () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", smoke], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return result;
  };
  const accept = () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "migration-runtime-smoke:ok");
  };
  accept();
  return { root, write, run, accept };
}

test("accepts current 90-migration inventory using the production runtime smoke", (context) => {
  fixture(context);
});

test("rejects every missing SQL migration", async (context) => {
  const f = fixture(context);
  for (const migration of migrations) {
    await context.test(migration.relative, () => {
      const path = join(f.root, migration.relative);
      const original = readFileSync(path);
      rmSync(path);
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /ENOENT|SQL migration set mismatch/u);
      f.write(migration.relative, original);
    });
  }
  f.accept();
});

test("rejects an extra SQL migration for every owner", async (context) => {
  const f = fixture(context);
  for (const owner of owners) {
    await context.test(owner, () => {
      const relative = `${owner}/migrations/9999_unapproved.sql`;
      f.write(relative, "-- generated extra migration\n");
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /SQL migration set mismatch/u);
      rmSync(join(f.root, relative));
    });
  }
  f.accept();
});

test("rejects changed bytes in every checksum-bound SQL migration", async (context) => {
  const f = fixture(context);
  for (const migration of migrations) {
    await context.test(migration.relative, () => {
      const original = readFileSync(join(f.root, migration.relative));
      f.write(migration.relative, Buffer.concat([original, Buffer.from("\n-- altered fixture\n")]));
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /SQL migration checksum mismatch/u);
      f.write(migration.relative, original);
    });
  }
  f.accept();
});

test("rejects a SQL filename replacement at unchanged owner counts", async (context) => {
  const f = fixture(context);
  for (const owner of owners) {
    await context.test(owner, () => {
      const migration = migrations.find((x) => x.owner === owner);
      const original = readFileSync(join(f.root, migration.relative));
      const replacement = `${owner}/migrations/9999_unapproved.sql`;
      rmSync(join(f.root, migration.relative));
      f.write(replacement, original);
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /ENOENT|SQL migration set mismatch/u);
      rmSync(join(f.root, replacement));
      f.write(migration.relative, original);
    });
  }
  f.accept();
});

test("rejects manifest version replacement at unchanged migration counts", async (context) => {
  const f = fixture(context);
  for (const contributor of manifest.contributors) {
    await context.test(contributor.owner, () => {
      const altered = structuredClone(manifest);
      const alteredContributor = altered.contributors.find((x) => x.owner === contributor.owner);
      alteredContributor.migrations[0].version = "9999_unapproved";
      alteredContributor.migrations.sort((left, right) =>
        left.version < right.version ? -1 : left.version > right.version ? 1 : 0,
      );
      f.write("runner/restore-manifest.v1.json", JSON.stringify(altered));
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /restore manifest SQL migration set mismatch/u);
      f.write("runner/restore-manifest.v1.json", JSON.stringify(manifest));
    });
  }
  f.accept();
});

test("rejects a mismatched manifest checksum for every owner", async (context) => {
  const f = fixture(context);
  for (const contributor of manifest.contributors) {
    await context.test(contributor.owner, () => {
      const altered = structuredClone(manifest);
      altered.contributors.find((x) => x.owner === contributor.owner).migrations[0].checksum =
        "0".repeat(64);
      f.write("runner/restore-manifest.v1.json", JSON.stringify(altered));
      const result = f.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, /SQL migration checksum mismatch/u);
      f.write("runner/restore-manifest.v1.json", JSON.stringify(manifest));
    });
  }
  f.accept();
});

test("rejects a missing standalone legacy receipt maintenance executable", (context) => {
  const f = fixture(context);
  rmSync(join(f.root, "applications/dist/src/run-legacy-receipt-transition.js"));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/u);
});
