import { createHash } from "node:crypto";
import {
  loadCurrentRestoreManifest,
  parseRestoreManifest,
  type RestoreManifestSource,
  type RestoreSqlClient,
  type RestoreSqlExecutor,
  verifyRestoreDatabase,
} from "./restore-verifier.js";

const identifier = /^[a-z][a-z0-9_]{0,62}$/;
const sha256 = /^[a-f0-9]{64}$/;
const serializer = "postgres16-jsonb-whole-row-sha256-v1";
export const restoreDataLimits = Object.freeze({
  relations: 128,
  columnsPerRelation: 128,
  rowsPerRelation: 10_000,
  bytesPerRow: 262_144,
  bytesPerRelation: 4_194_304,
  totalRows: 100_000,
  totalBytes: 67_108_864,
  elapsedMs: 60_000,
});

export interface RestoreDataColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly identity: string;
  readonly generated: string;
}

export interface RestoreDataRelation {
  readonly relation: string;
  readonly columns: readonly RestoreDataColumn[];
  readonly rowCount: number;
  readonly byteCount: number;
  readonly rowDigest: string;
}

export interface RestoreDataInventory {
  readonly schemaVersion: 1;
  readonly serializer: typeof serializer;
  readonly manifestSha256: string;
  readonly relations: readonly RestoreDataRelation[];
  readonly digest: string;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function quote(value: string): string {
  if (!identifier.test(value)) throw new Error("Restore data identifier is invalid");
  return `"${value}"`;
}

function quoteRelation(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Restore data relation is invalid");
  return parts.map(quote).join(".");
}

function boundedInteger(value: unknown, maximum: number): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value)) {
    throw new Error("Restore data aggregate is invalid");
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > maximum) {
    throw new Error("Restore data budget exceeded");
  }
  return result;
}

// No caller SQL, projection, exclusion list or adjustable production budget is accepted.
export function buildRestoreDataQuery(relation: string): string {
  const table = quoteRelation(relation);
  return `WITH records AS MATERIALIZED (
    SELECT octet_length(payload) AS row_bytes,
      CASE WHEN octet_length(payload) <= ${restoreDataLimits.bytesPerRow}
        THEN encode(sha256(convert_to(payload, 'UTF8')), 'hex') ELSE NULL END AS row_hash
    FROM (SELECT to_jsonb(record)::text AS payload FROM ${table} AS record
      LIMIT ${restoreDataLimits.rowsPerRelation + 1}) AS bounded_rows
  ), stats AS (
    SELECT count(*) AS row_count,
      COALESCE(sum(row_bytes), 0) AS byte_count,
      COALESCE(max(row_bytes), 0) AS max_row_bytes FROM records
  ) SELECT row_count::text, byte_count::text, max_row_bytes::text,
    CASE WHEN row_count <= ${restoreDataLimits.rowsPerRelation}
      AND byte_count <= ${restoreDataLimits.bytesPerRelation}
      AND max_row_bytes <= ${restoreDataLimits.bytesPerRow}
    THEN (SELECT encode(sha256(convert_to('restore-data-rows-v1:' ||
      COALESCE(string_agg(row_hash, '' ORDER BY row_hash COLLATE "C"), ''), 'UTF8')), 'hex')
      FROM records)
    ELSE NULL END AS row_digest FROM stats`;
}

async function attestSerialization(transaction: RestoreSqlExecutor): Promise<void> {
  await transaction.unsafe(`SET LOCAL TimeZone = 'UTC'; SET LOCAL DateStyle = 'ISO, YMD';
    SET LOCAL IntervalStyle = 'iso_8601'; SET LOCAL extra_float_digits = 3;
    SET LOCAL bytea_output = 'hex'; SET LOCAL row_security = off; SET LOCAL search_path = pg_catalog`);
  const rows = await transaction.unsafe<{ settings: unknown }>(`SELECT json_build_array(
    current_setting('TimeZone'), current_setting('DateStyle'), current_setting('IntervalStyle'),
    current_setting('extra_float_digits'), current_setting('bytea_output'),
    current_setting('row_security'), current_setting('server_encoding'),
    current_setting('client_encoding'), current_setting('server_version_num')::int / 10000,
    current_setting('search_path')
  ) AS settings`);
  if (
    rows.length !== 1 ||
    JSON.stringify(rows[0]?.settings) !==
      JSON.stringify([
        "UTC",
        "ISO, YMD",
        "iso_8601",
        "3",
        "hex",
        "off",
        "UTF8",
        "UTF8",
        16,
        "pg_catalog",
      ])
  ) {
    throw new Error("Restore data serialization boundary mismatch");
  }
}

async function readColumns(
  transaction: RestoreSqlExecutor,
  expected: readonly string[],
): Promise<Map<string, RestoreDataColumn[]>> {
  // Include unsupported relation kinds so a view/foreign/partitioned replacement cannot hide.
  const tables = await transaction.unsafe<Record<string, unknown>>(`SELECT
    n.nspname AS schema_name, c.relname AS relation_name, c.relkind,
    c.relrowsecurity, c.relforcerowsecurity, c.relispartition,
    has_table_privilege(c.oid, 'SELECT') AS selectable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"
    LIMIT ${restoreDataLimits.relations + 1}`);
  if (
    JSON.stringify(tables.map((row) => `${row.schema_name}.${row.relation_name}`)) !==
      JSON.stringify(expected) ||
    tables.some(
      (row) =>
        row.relkind !== "r" ||
        row.relrowsecurity !== false ||
        row.relforcerowsecurity !== false ||
        row.relispartition !== false ||
        row.selectable !== true,
    )
  ) {
    throw new Error("Restore data whole-table visibility boundary mismatch");
  }
  const rows = await transaction.unsafe<Record<string, unknown>>(`SELECT
    n.nspname AS schema_name, c.relname AS relation_name, a.attname AS column_name,
    format_type(a.atttypid, a.atttypmod) AS column_type,
    tn.nspname AS type_schema, a.attnotnull, a.attidentity, a.attgenerated
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid JOIN pg_namespace tn ON tn.oid = t.typnamespace
    WHERE n.nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
      AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C", a.attnum
    LIMIT ${restoreDataLimits.relations * restoreDataLimits.columnsPerRelation + 1}`);
  const result = new Map(expected.map((relation) => [relation, [] as RestoreDataColumn[]]));
  for (const row of rows) {
    const columns = result.get(`${row.schema_name}.${row.relation_name}`);
    if (
      !columns ||
      columns.length >= restoreDataLimits.columnsPerRelation ||
      typeof row.column_name !== "string" ||
      !identifier.test(row.column_name) ||
      columns.some((column) => column.name === row.column_name) ||
      typeof row.column_type !== "string" ||
      row.column_type.length > 128 ||
      row.type_schema !== "pg_catalog" ||
      typeof row.attnotnull !== "boolean" ||
      !["", "a", "d"].includes(String(row.attidentity)) ||
      !["", "s"].includes(String(row.attgenerated))
    ) {
      throw new Error("Restore data column boundary mismatch");
    }
    columns.push({
      name: row.column_name,
      type: row.column_type,
      notNull: row.attnotnull,
      identity: String(row.attidentity),
      generated: String(row.attgenerated),
    });
  }
  if ([...result.values()].some((columns) => columns.length === 0)) {
    throw new Error("Restore data column inventory is incomplete");
  }
  return result;
}

export async function collectRestoreDataInventory(
  client: RestoreSqlClient,
  source: RestoreManifestSource = loadCurrentRestoreManifest(),
): Promise<RestoreDataInventory> {
  const manifest = parseRestoreManifest(source.manifest);
  const expected = manifest.contributors.flatMap((owner) => owner.relations).sort();
  if (!sha256.test(source.sha256) || expected.length > restoreDataLimits.relations) {
    throw new Error("Restore data manifest boundary mismatch");
  }
  const started = performance.now();
  const checkDeadline = () => {
    if (performance.now() - started > restoreDataLimits.elapsedMs) {
      throw new Error("Restore data time budget exceeded");
    }
  };
  try {
    return await client.begin("read only isolation level repeatable read", async (transaction) => {
      await transaction.unsafe("SET LOCAL search_path = pg_catalog");
      // Reuse the exact schema/ledger and transaction-safety checks in this SAME snapshot.
      await verifyRestoreDatabase(
        { begin: async (_options, work) => work(transaction) },
        { manifest, sha256: source.sha256 },
      );
      checkDeadline();
      await attestSerialization(transaction);
      const columns = await readColumns(transaction, expected);
      const relations: RestoreDataRelation[] = [];
      let totalRows = 0;
      let totalBytes = 0;
      for (const relation of expected) {
        checkDeadline();
        const rows = await transaction.unsafe<Record<string, unknown>>(
          buildRestoreDataQuery(relation),
        );
        const row = rows[0];
        if (
          rows.length !== 1 ||
          !row ||
          typeof row.row_digest !== "string" ||
          !sha256.test(row.row_digest)
        ) {
          throw new Error("Restore data aggregate boundary mismatch");
        }
        const rowCount = boundedInteger(row.row_count, restoreDataLimits.rowsPerRelation);
        const byteCount = boundedInteger(row.byte_count, restoreDataLimits.bytesPerRelation);
        boundedInteger(row.max_row_bytes, restoreDataLimits.bytesPerRow);
        totalRows += rowCount;
        totalBytes += byteCount;
        if (totalRows > restoreDataLimits.totalRows || totalBytes > restoreDataLimits.totalBytes) {
          throw new Error("Restore data total budget exceeded");
        }
        relations.push({
          relation,
          columns: columns.get(relation) ?? [],
          rowCount,
          byteCount,
          rowDigest: row.row_digest,
        });
      }
      checkDeadline();
      const body: Omit<RestoreDataInventory, "digest"> = {
        schemaVersion: 1 as const,
        serializer,
        manifestSha256: source.sha256,
        relations,
      };
      return { ...body, digest: digest(body) };
    });
  } catch {
    // Database errors may contain candidate values, SQL fragments or connection credentials.
    throw new Error("Restore data inventory failed");
  }
}

/** Diagnostic equality only. Never authorizes promotion, privacy replay, or receipt transformations. */
function exactKeys(value: unknown, expected: readonly string[]): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())
  ) {
    throw new Error("Restore data comparison shape is invalid");
  }
}

export function compareRestoreDataInventories(
  left: RestoreDataInventory,
  right: RestoreDataInventory,
  leftSource: RestoreManifestSource = loadCurrentRestoreManifest(),
  rightSource: RestoreManifestSource = leftSource,
): {
  readonly equal: boolean;
  readonly manifestEqual: boolean;
  readonly differingRelations: readonly string[];
} {
  for (const [inventory, source] of [
    [left, leftSource],
    [right, rightSource],
  ] as const) {
    exactKeys(inventory, ["schemaVersion", "serializer", "manifestSha256", "relations", "digest"]);
    const expected = parseRestoreManifest(source.manifest)
      .contributors.flatMap((owner) => owner.relations)
      .sort();
    const { digest: claimed, ...body } = inventory;
    if (
      inventory.schemaVersion !== 1 ||
      inventory.serializer !== serializer ||
      !Array.isArray(inventory.relations) ||
      inventory.manifestSha256 !== source.sha256 ||
      JSON.stringify(inventory.relations.map((row) => row.relation)) !== JSON.stringify(expected) ||
      !sha256.test(inventory.manifestSha256) ||
      claimed !== digest(body) ||
      inventory.relations.length > restoreDataLimits.relations ||
      new Set(inventory.relations.map((row) => row.relation)).size !== inventory.relations.length
    )
      throw new Error("Restore data comparison inventory is invalid");
    let totalRows = 0;
    let totalBytes = 0;
    for (const row of inventory.relations) {
      exactKeys(row, ["relation", "columns", "rowCount", "byteCount", "rowDigest"]);
      quoteRelation(row.relation);
      if (
        typeof row.rowCount !== "number" ||
        typeof row.byteCount !== "number" ||
        !Number.isSafeInteger(row.rowCount) ||
        !Number.isSafeInteger(row.byteCount) ||
        !Array.isArray(row.columns)
      )
        throw new Error("Restore data comparison count is invalid");
      boundedInteger(String(row.rowCount), restoreDataLimits.rowsPerRelation);
      boundedInteger(String(row.byteCount), restoreDataLimits.bytesPerRelation);
      if (
        !sha256.test(row.rowDigest) ||
        row.columns.length === 0 ||
        row.columns.length > restoreDataLimits.columnsPerRelation ||
        new Set(row.columns.map((column: RestoreDataColumn) => column.name)).size !==
          row.columns.length
      ) {
        throw new Error("Restore data comparison relation is invalid");
      }
      for (const column of row.columns) {
        exactKeys(column, ["name", "type", "notNull", "identity", "generated"]);
        quote(column.name);
        if (
          typeof column.type !== "string" ||
          column.type.length === 0 ||
          column.type.length > 128 ||
          typeof column.notNull !== "boolean" ||
          !["", "a", "d"].includes(column.identity) ||
          !["", "s"].includes(column.generated)
        )
          throw new Error("Restore data comparison column is invalid");
      }
      totalRows += row.rowCount;
      totalBytes += row.byteCount;
    }
    if (totalRows > restoreDataLimits.totalRows || totalBytes > restoreDataLimits.totalBytes) {
      throw new Error("Restore data comparison budget exceeded");
    }
  }
  const leftRows = new Map(left.relations.map((row) => [row.relation, row]));
  const rightRows = new Map(right.relations.map((row) => [row.relation, row]));
  const differingRelations = [...new Set([...leftRows.keys(), ...rightRows.keys()])]
    .sort()
    .filter(
      (relation) =>
        JSON.stringify(leftRows.get(relation)) !== JSON.stringify(rightRows.get(relation)),
    );
  const manifestEqual = left.manifestSha256 === right.manifestSha256;
  return {
    equal: manifestEqual && differingRelations.length === 0,
    manifestEqual,
    differingRelations,
  };
}
