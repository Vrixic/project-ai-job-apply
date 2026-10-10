import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildRestoreDataQuery,
  collectRestoreDataInventory,
  compareRestoreDataInventories,
} from "../../../backend/services/database-migrations/dist/src/restore-data-inventory.js";
import { parseRestoreManifest } from "../../../backend/services/database-migrations/dist/src/restore-verifier.js";

// This receives only the harness's new, empty third database in its owned disposable container.
export async function exerciseRestoreDataInventory(client) {
  const manifest = parseRestoreManifest({
    schemaVersion: 1,
    manifestId: "synthetic-restore-data-probe-v1",
    contributors: [
      {
        owner: "probe",
        schemas: ["probe"],
        migrationLedger: "probe.schema_migrations",
        migrations: [{ version: "0001_probe", checksum: "a".repeat(64) }],
        relations: ["probe.rows", "probe.schema_migrations"],
      },
    ],
  });
  const source = {
    manifest,
    sha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  };
  await client.unsafe(`CREATE SCHEMA probe;
    CREATE TABLE probe.schema_migrations (version text NOT NULL, checksum text NOT NULL);
    INSERT INTO probe.schema_migrations VALUES ('0001_probe', repeat('a',64));
    CREATE TABLE probe.rows (id bigint, value text, payload jsonb, instant timestamptz,
      bytes bytea, duration interval, amount numeric);
    INSERT INTO probe.rows VALUES
      (9007199254740993, 'synthetic-a', '{"a":1,"b":2}', '2026-01-01T00:00:00.123456Z',
       decode('00ff','hex'), interval '1 day 0.123456 seconds', 12345678901234567890.123456789);`);
  const read = () => collectRestoreDataInventory(client, source);
  const same = (left, right) => compareRestoreDataInventories(left, right, source).equal;
  const baseline = await read();
  assert.equal(same(baseline, await read()), true);
  let cases = 1;
  const [plan] = await client.unsafe(
    `EXPLAIN (VERBOSE, FORMAT JSON) ${buildRestoreDataQuery("probe.rows")}`,
  );
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan["QUERY PLAN"][0].Plan);
  const materialized = nodes.find((node) => node["Subplan Name"] === "CTE records");
  assert.equal(materialized.Output.length, 2);
  assert.match(materialized.Output[0], /octet_length/u);
  assert.match(materialized.Output[1], /CASE/u);
  cases++;
  // Neither driver date rounding nor JS numeric coercion may hide these changes.
  for (const [change, restore] of [
    ["value='synthetic-b'", "value='synthetic-a'"],
    ["id=9007199254740992", "id=9007199254740993"],
    ["instant='2026-01-01T00:00:00.123457Z'", "instant='2026-01-01T00:00:00.123456Z'"],
    ["value=NULL", "value='synthetic-a'"],
    ["bytes=decode('00fe','hex')", "bytes=decode('00ff','hex')"],
    ["amount=12345678901234567890.123456788", "amount=12345678901234567890.123456789"],
  ]) {
    await client.unsafe(`UPDATE probe.rows SET ${change}`);
    assert.equal(same(baseline, await read()), false);
    await client.unsafe(`UPDATE probe.rows SET ${restore}`);
    assert.equal(same(baseline, await read()), true);
    cases++;
  }
  await client.unsafe(`UPDATE probe.rows SET payload='{"b":2,"a":1}';
    SET TimeZone='Pacific/Honolulu'; SET DateStyle='SQL, DMY'; SET IntervalStyle='postgres';
    SET bytea_output='escape'; SET extra_float_digits=0;`);
  assert.equal(same(baseline, await read()), true);
  cases++;
  await client.unsafe(
    "INSERT INTO probe.rows SELECT id+1,'synthetic-c',payload,instant,bytes,duration,amount FROM probe.rows",
  );
  const associated = await read();
  await client.unsafe(
    "UPDATE probe.rows SET value=CASE WHEN id=9007199254740993 THEN 'synthetic-c' ELSE 'synthetic-a' END",
  );
  assert.equal(same(associated, await read()), false);
  await client.unsafe(
    "UPDATE probe.rows SET value=CASE WHEN id=9007199254740993 THEN 'synthetic-a' ELSE 'synthetic-c' END",
  );
  assert.equal(same(associated, await read()), true);
  await client.unsafe("DELETE FROM probe.rows WHERE id=9007199254740994");
  cases++;
  await client.unsafe("INSERT INTO probe.rows SELECT * FROM probe.rows");
  assert.equal(same(baseline, await read()), false);
  await client.unsafe("DELETE FROM probe.rows WHERE ctid=(SELECT ctid FROM probe.rows LIMIT 1)");
  assert.equal(same(baseline, await read()), true);
  cases++;
  await client.unsafe("ALTER TABLE probe.rows ADD COLUMN new_value text");
  assert.equal(same(baseline, await read()), false);
  await client.unsafe("ALTER TABLE probe.rows DROP COLUMN new_value");
  assert.equal(same(baseline, await read()), true);
  cases++;
  await client.unsafe("DELETE FROM probe.rows");
  const empty = await read();
  await client.unsafe("ALTER TABLE probe.rows ADD COLUMN new_value text");
  assert.equal(same(empty, await read()), false);
  await client.unsafe("ALTER TABLE probe.rows DROP COLUMN new_value");
  cases++;
  for (const [setup, cleanup] of [
    [
      "CREATE TABLE probe.extra (value text); INSERT INTO probe.extra VALUES ('synthetic')",
      "DROP TABLE probe.extra",
    ],
    ["CREATE VIEW probe.extra AS SELECT * FROM probe.rows", "DROP VIEW probe.extra"],
    [
      "ALTER TABLE probe.rows ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE probe.rows DISABLE ROW LEVEL SECURITY",
    ],
    [
      "INSERT INTO probe.rows (value) SELECT 'synthetic' FROM generate_series(1,10001)",
      "DELETE FROM probe.rows",
    ],
    ["INSERT INTO probe.rows (value) VALUES (repeat('x',262145))", "DELETE FROM probe.rows"],
    [
      "INSERT INTO probe.rows (value) SELECT repeat('x',210000) FROM generate_series(1,21)",
      "DELETE FROM probe.rows",
    ],
  ]) {
    await client.unsafe(setup);
    await assert.rejects(read, { message: "Restore data inventory failed" });
    await client.unsafe(cleanup);
    cases++;
  }
  // Migration changes are not ignored just because the table remains present.
  await client.unsafe("UPDATE probe.schema_migrations SET checksum=repeat('b',64)");
  await assert.rejects(read, { message: "Restore data inventory failed" });
  await client.unsafe("UPDATE probe.schema_migrations SET checksum=repeat('a',64)");
  cases++;
  assert.equal(JSON.stringify(baseline).includes("synthetic-a"), false);
  assert.equal(JSON.stringify(baseline).includes("9007199254740993"), false);
  assert.equal(JSON.stringify(baseline).includes("123456"), false);
  cases++;
  return { restoreDataInventoryProbeCases: cases };
}
