import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { migrationRunners } from "../../../backend/services/database-migrations/dist/src/index.js";
import {
  loadCurrentRestoreManifest,
  verifyRestoreDatabase,
} from "../../../backend/services/database-migrations/dist/src/restore-verifier.js";
import { createRestoreClient } from "../../../backend/services/database-migrations/dist/src/restore-verifier-runtime.js";
import { createJobCatalogDatabase } from "../../../backend/services/jobs/dist/src/persistence/catalog.js";
import { createDatabase } from "../../../backend/services/profile/dist/src/index.js";
import { assertOwnedContainer, image, label, ownedDatabasePort } from "./container-boundary.mjs";
import {
  exerciseRestoredD2,
  requiredNonemptyD2Relations,
  seedD2RecoveryFixtures,
} from "./fixtures.mjs";
import {
  exerciseRestoredResponseInventory,
  exerciseRestoredTemporaryMaterialCompletion,
  seedResponseInventory,
  seedTemporaryMaterialCompletion,
} from "./response-inventory.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const execute = promisify(execFile);
// Inherit OS process-launch paths only, never database, cloud, Auth0, provider or
// development runtime settings. Docker uses the explicit local engine below.
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
  ),
);
const dockerHost =
  process.platform === "win32"
    ? "npipe:////./pipe/dockerDesktopLinuxEngine"
    : "unix:///var/run/docker.sock";
const nonce = randomBytes(16).toString("hex");
const name = `d2-recovery-${nonce}`;
const password = randomBytes(32).toString("hex");
const clients = [];
let owned;
let creationAttempted = false;
let stage = "local-image";
let result;
let failure;

async function command(executable, args, extraEnvironment = {}) {
  return execute(executable, args, {
    cwd: repository,
    env: { ...environment, ...extraEnvironment },
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: "utf8",
  });
}

const docker = (args) => command("docker", ["--host", dockerHost, ...args]);

async function inspect(target) {
  const response = await docker(["container", "inspect", target]);
  const values = JSON.parse(response.stdout);
  assert.equal(values.length, 1);
  return values[0];
}

async function databaseReady() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      // The image bootstrap briefly runs a socket-only temporary server; wait
      // for the final TCP listener, not that intermediate initialization phase.
      await docker([
        "exec",
        owned.id,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "ai_job_apply",
        "-d",
        "d2_source",
      ]);
      return;
    } catch {
      await delay(300);
    }
  }
  throw new Error("The generated recovery database did not become ready");
}

async function exactRows(client, manifest) {
  return client.begin("read only isolation level repeatable read", async (transaction) => {
    await transaction.unsafe("SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '2s'");
    const rows = {};
    for (const relation of manifest.contributors.flatMap((owner) => owner.relations)) {
      assert.match(relation, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u);
      const quoted = relation
        .split(".")
        .map((part) => `"${part}"`)
        .join(".");
      const [value] = await transaction.unsafe(`
        SELECT COALESCE(jsonb_agg(value ORDER BY value::text), '[]'::jsonb)::text AS payload
        FROM (SELECT to_jsonb(row_data) AS value FROM ${quoted} AS row_data) AS records
      `);
      assert.equal(typeof value?.payload, "string");
      rows[relation] = value.payload;
    }
    return rows;
  });
}

async function rejectReadOnlyWrite(client) {
  await assert.rejects(
    client.begin("read only isolation level repeatable read", (transaction) =>
      transaction.unsafe("UPDATE jobs.schema_migrations SET checksum = checksum WHERE false"),
    ),
    { code: "25006" },
  );
}

async function cleanupContainer() {
  if (!creationAttempted) return;
  // Recover the exact generated name if Docker created the container but the run
  // response was interrupted. No removal occurs without every boundary.
  if (!owned) {
    try {
      const container = await inspect(name);
      owned = { id: container.Id, nonce, name };
      assertOwnedContainer(container, owned);
    } catch (error) {
      if (!String(error?.stderr ?? "").includes("No such container:")) throw error;
    }
  }
  if (!owned) return;
  assertOwnedContainer(await inspect(owned.id), owned);
  await docker(["container", "rm", "--force", owned.id]);
  const remaining = await docker([
    "container",
    "ls",
    "--all",
    "--quiet",
    "--no-trunc",
    "--filter",
    `id=${owned.id}`,
  ]);
  assert.equal(remaining.stdout.trim(), "");
}

try {
  await docker(["image", "inspect", image]);
  stage = "container-creation";
  creationAttempted = true;
  const created = await docker([
    "run",
    "--pull",
    "never",
    "--detach",
    "--name",
    name,
    "--label",
    `${label}=${nonce}`,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,size=256m",
    "--tmpfs",
    "/d2-recovery:rw,size=128m",
    "--env",
    "POSTGRES_DB=d2_source",
    "--env",
    "POSTGRES_USER=ai_job_apply",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    image,
  ]);
  owned = { id: created.stdout.trim(), nonce, name };
  const container = await inspect(owned.id);
  const port = ownedDatabasePort(container, owned);
  stage = "database-readiness";
  await databaseReady();
  const sourceUrl = `postgres://ai_job_apply:${password}@127.0.0.1:${port}/d2_source`;
  const targetUrl = `postgres://ai_job_apply:${password}@127.0.0.1:${port}/d2_target`;
  const source = loadCurrentRestoreManifest();
  assert.equal(source.manifest.contributors.length, 7);
  assert.equal(source.manifest.contributors.flatMap((owner) => owner.schemas).length, 11);
  assert.equal(source.manifest.contributors.flatMap((owner) => owner.relations).length, 84);
  assert.equal(source.manifest.contributors.flatMap((owner) => owner.migrations).length, 62);
  assert.equal(
    source.manifest.contributors.find((owner) => owner.owner === "trust").migrations.at(-1).version,
    "0005_development_test_removal",
  );
  // Reapply while only the source DB exists. The Jobs reader-role CONNECT boundary
  // is cluster-wide; a second migrated database is deliberately not allowed here.
  for (const pass of ["fresh", "replay"]) {
    for (const runner of migrationRunners) {
      stage = `migrate-${pass}-${runner.owner}`;
      const migrated = await command(
        process.execPath,
        [resolve(repository, "backend/services", runner.executable)],
        {
          NODE_ENV: "test",
          DATABASE_URL: sourceUrl,
        },
      );
      const owner = source.manifest.contributors.find((entry) => entry.owner === runner.owner);
      const heading =
        runner.owner === "profile"
          ? "Database"
          : `${runner.owner[0].toUpperCase()}${runner.owner.slice(1)}`;
      assert.equal(
        migrated.stdout.trim(),
        `${heading} migrations through ${owner.migrations.at(-1).version} applied and verified.`,
      );
    }
  }
  // Match both actual runtime boundaries: Profile/Gateway initializes Drizzle's
  // JSON serializers, while the Jobs worker uses its own raw postgres pool.
  const sourceStore = createJobCatalogDatabase(sourceUrl, { maxConnections: 3 });
  const sourceProfile = createDatabase(sourceUrl, { maxConnections: 2 }).client;
  const sourceReader = createRestoreClient(sourceUrl);
  clients.push(sourceStore, sourceProfile, sourceReader);
  stage = "seed-generated-d2-fixtures";
  const fixtures = await seedD2RecoveryFixtures(sourceStore, sourceProfile, (value) => {
    stage = value;
  });
  stage = "seed-generated-response-inventory";
  const responseFixtures = await seedResponseInventory(sourceStore, fixtures.ownerUserId);
  const materialFixture = await seedTemporaryMaterialCompletion(sourceStore, fixtures.ownerUserId);
  stage = "source-aggregate-and-row-snapshot";
  const sourceAggregate = await verifyRestoreDatabase(sourceReader, source);
  const sourceRows = await exactRows(sourceReader, source.manifest);
  for (const relation of requiredNonemptyD2Relations) {
    assert.ok(
      JSON.parse(sourceRows[relation]).length > 0,
      `Required generated D2 relation is empty: ${relation}`,
    );
  }
  await rejectReadOnlyWrite(sourceReader);
  stage = "logical-dump";
  await docker([
    "exec",
    owned.id,
    "pg_dump",
    "-U",
    "ai_job_apply",
    "-d",
    "d2_source",
    "--format=custom",
    "--file=/d2-recovery/source.dump",
  ]);
  stage = "create-restore-target";
  await docker([
    "exec",
    owned.id,
    "createdb",
    "-U",
    "ai_job_apply",
    "--template=template0",
    "d2_target",
  ]);
  stage = "logical-restore";
  await docker([
    "exec",
    owned.id,
    "pg_restore",
    "-U",
    "ai_job_apply",
    "-d",
    "d2_target",
    "--exit-on-error",
    "--single-transaction",
    "/d2-recovery/source.dump",
  ]);
  const targetStore = createJobCatalogDatabase(targetUrl, { maxConnections: 3 });
  const targetProfile = createDatabase(targetUrl, { maxConnections: 2 }).client;
  const targetReader = createRestoreClient(targetUrl);
  clients.push(targetStore, targetProfile, targetReader);
  stage = "restored-aggregate-and-row-equality";
  assert.deepEqual(await verifyRestoreDatabase(targetReader, source), sourceAggregate);
  assert.deepEqual(await exactRows(targetReader, source.manifest), sourceRows);
  await rejectReadOnlyWrite(targetReader);
  stage = "restored-response-inventory-behavior";
  const responseBehavior = await exerciseRestoredResponseInventory(targetStore, responseFixtures);
  const materialBehavior = await exerciseRestoredTemporaryMaterialCompletion(
    targetStore,
    materialFixture,
  );
  stage = "restored-d2-behavior";
  const behavior = await exerciseRestoredD2(targetStore, targetProfile, fixtures, (value) => {
    stage = value;
  });
  stage = "source-isolation";
  assert.deepEqual(await exactRows(sourceReader, source.manifest), sourceRows);
  result = {
    profile: "d2_generated_logical_recovery_v1",
    migrationCount: 62,
    ownerCount: 7,
    schemaCount: 11,
    exactRelationRowSetsMatched: 84,
    nonemptyD2RelationsMatched: requiredNonemptyD2Relations.length,
    aggregateVerifierMatched: true,
    sourceUnchanged: true,
    readOnlyWritesRejected: 2,
    ...responseBehavior,
    ...materialBehavior,
    ...behavior,
  };
} catch (error) {
  // Child-process errors may contain generated credentials; never print them or
  // assertion values (which could contain fixture rows). Keep only safe codes.
  const code =
    typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/u.test(error.code)
      ? error.code
      : "FAILED";
  const location =
    typeof error?.stack === "string"
      ? /((?:fixtures|response-inventory|run)\.mjs:[0-9]+:[0-9]+)/u.exec(error.stack)?.[1]
      : undefined;
  failure = { stage, code, ...(location ? { testLocation: location } : {}) };
} finally {
  const closed = await Promise.allSettled(clients.map((client) => client.end({ timeout: 5 })));
  if (closed.some((item) => item.status === "rejected"))
    failure ??= { stage: "database-client-cleanup", code: "FAILED" };
  try {
    await cleanupContainer();
  } catch {
    failure = { stage: "owned-container-cleanup", code: "FAILED" };
  }
}

if (failure) {
  process.stderr.write(
    `${JSON.stringify({ profile: "d2_generated_logical_recovery_v1", ...failure, passed: false })}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ ...result, cleanupSucceeded: true, passed: true }, null, 2)}\n`,
  );
}
