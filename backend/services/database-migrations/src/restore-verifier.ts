import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const MIGRATION_VERSION_PATTERN = /^[0-9]{4}_[a-z0-9_]{1,58}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface RestoreMigration {
  readonly version: string;
  readonly checksum: string;
}

export interface RestoreContributor {
  readonly owner: string;
  readonly schemas: readonly string[];
  readonly migrationLedger: string;
  readonly migrations: readonly RestoreMigration[];
  readonly relations: readonly string[];
}

export interface RestoreManifest {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  readonly contributors: readonly RestoreContributor[];
}

export interface RestoreManifestSource {
  readonly manifest: RestoreManifest;
  readonly sha256: string;
}

export interface RestoreVerificationResult {
  readonly manifestId: string;
  readonly manifestSha256: string;
  readonly ownerCount: number;
  readonly relationCount: number;
  readonly migrationCount: number;
  readonly aggregateDigest: string;
}

export interface RestoreVerificationEvent {
  readonly event: "d1_restore_verification";
  readonly schema_version: 1;
  readonly kind: "read_only_aggregate";
  readonly manifest_id: string;
  readonly manifest_sha256: string;
  readonly owner_count: number;
  readonly relation_count: number;
  readonly migration_count: number;
  readonly digest: string;
}

export interface RestoreSqlExecutor {
  unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]>;
}

export interface RestoreSqlClient {
  begin<T>(
    options: "read only isolation level repeatable read",
    work: (transaction: RestoreSqlExecutor) => Promise<T>,
  ): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).every((key) => expected.has(key)) &&
    Object.keys(value).length === keys.length
  );
}

function parseQualifiedIdentifier(value: unknown, label: string): readonly [string, string] {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a qualified identifier`);
  }
  const parts = value.split(".");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !IDENTIFIER_PATTERN.test(parts[0]) ||
    !IDENTIFIER_PATTERN.test(parts[1])
  ) {
    throw new Error(`${label} must be a safe schema-qualified identifier`);
  }
  return [parts[0], parts[1]];
}

function uniqueSorted(values: readonly string[], label: string): readonly string[] {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`${label} contains a duplicate`);
  }
  return sorted;
}

function requireCanonicalOrder(values: readonly string[], label: string): void {
  const sorted = [...values].sort();
  if (JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(`${label} must use canonical lexical order`);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function parseRestoreManifest(value: unknown): RestoreManifest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schemaVersion", "manifestId", "contributors"]) ||
    value.schemaVersion !== 1 ||
    typeof value.manifestId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,95}$/.test(value.manifestId) ||
    !Array.isArray(value.contributors) ||
    value.contributors.length === 0
  ) {
    throw new Error("Restore manifest has an invalid top-level boundary");
  }

  const contributors = value.contributors.map((candidate, contributorIndex) => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ["owner", "schemas", "migrationLedger", "migrations", "relations"]) ||
      typeof candidate.owner !== "string" ||
      !IDENTIFIER_PATTERN.test(candidate.owner) ||
      !Array.isArray(candidate.schemas) ||
      candidate.schemas.length === 0 ||
      !Array.isArray(candidate.migrations) ||
      candidate.migrations.length === 0 ||
      !Array.isArray(candidate.relations) ||
      candidate.relations.length === 0
    ) {
      throw new Error(`Restore contributor ${contributorIndex} is invalid`);
    }

    const schemas = candidate.schemas.map((schema, schemaIndex) => {
      if (typeof schema !== "string" || !IDENTIFIER_PATTERN.test(schema)) {
        throw new Error(`Restore contributor ${candidate.owner} schema ${schemaIndex} is invalid`);
      }
      return schema;
    });
    const sortedSchemas = uniqueSorted(schemas, `Restore contributor ${candidate.owner} schemas`);
    requireCanonicalOrder(schemas, `Restore contributor ${candidate.owner} schemas`);
    const migrationLedger = parseQualifiedIdentifier(
      candidate.migrationLedger,
      `Restore contributor ${candidate.owner} migration ledger`,
    ).join(".");
    if (!sortedSchemas.includes(migrationLedger.split(".")[0] ?? "")) {
      throw new Error(`Restore contributor ${candidate.owner} does not own its migration ledger`);
    }

    const migrations = candidate.migrations.map((migration, migrationIndex) => {
      if (
        !isRecord(migration) ||
        !hasOnlyKeys(migration, ["version", "checksum"]) ||
        typeof migration.version !== "string" ||
        !MIGRATION_VERSION_PATTERN.test(migration.version) ||
        typeof migration.checksum !== "string" ||
        !SHA256_PATTERN.test(migration.checksum)
      ) {
        throw new Error(
          `Restore contributor ${candidate.owner} migration ${migrationIndex} is invalid`,
        );
      }
      return { version: migration.version, checksum: migration.checksum };
    });
    uniqueSorted(
      migrations.map((migration) => migration.version),
      `Restore contributor ${candidate.owner} migrations`,
    );
    requireCanonicalOrder(
      migrations.map((migration) => migration.version),
      `Restore contributor ${candidate.owner} migrations`,
    );

    const relations = candidate.relations.map((relation, relationIndex) => {
      const qualified = parseQualifiedIdentifier(
        relation,
        `Restore contributor ${candidate.owner} relation ${relationIndex}`,
      );
      if (!sortedSchemas.includes(qualified[0])) {
        throw new Error(`Restore contributor ${candidate.owner} does not own relation ${relation}`);
      }
      return qualified.join(".");
    });
    const sortedRelations = uniqueSorted(
      relations,
      `Restore contributor ${candidate.owner} relations`,
    );
    requireCanonicalOrder(relations, `Restore contributor ${candidate.owner} relations`);
    if (!sortedRelations.includes(migrationLedger)) {
      throw new Error(`Restore contributor ${candidate.owner} omits its migration ledger relation`);
    }

    return {
      owner: candidate.owner,
      schemas: sortedSchemas,
      migrationLedger,
      migrations,
      relations: sortedRelations,
    } satisfies RestoreContributor;
  });

  uniqueSorted(
    contributors.map((contributor) => contributor.owner),
    "Restore contributor owners",
  );
  requireCanonicalOrder(
    contributors.map((contributor) => contributor.owner),
    "Restore contributor owners",
  );
  const schemaOwners = new Map<string, string>();
  for (const contributor of contributors) {
    for (const schema of contributor.schemas) {
      const existingOwner = schemaOwners.get(schema);
      if (existingOwner) {
        throw new Error(
          `Restore schema ${schema} is claimed by ${existingOwner} and ${contributor.owner}`,
        );
      }
      schemaOwners.set(schema, contributor.owner);
    }
  }

  return deepFreeze({
    schemaVersion: 1,
    manifestId: value.manifestId,
    contributors,
  });
}

export function createRestoreManifest(
  base: RestoreManifest,
  additions: readonly RestoreContributor[],
  manifestId: string,
): RestoreManifest {
  return parseRestoreManifest({
    schemaVersion: 1,
    manifestId,
    contributors: [...base.contributors, ...additions].sort((left, right) =>
      left.owner.localeCompare(right.owner),
    ),
  });
}

function manifestCandidates(): readonly URL[] {
  return [
    new URL("../restore-manifest.v1.json", import.meta.url),
    new URL("../../restore-manifest.v1.json", import.meta.url),
  ];
}

export function loadCurrentRestoreManifest(): RestoreManifestSource {
  const candidate = manifestCandidates().find((url) => existsSync(url));
  if (!candidate) {
    throw new Error("The versioned restore manifest is unavailable");
  }
  const bytes = readFileSync(candidate);
  const manifest = parseRestoreManifest(JSON.parse(bytes.toString("utf8")) as unknown);
  return deepFreeze({
    manifest,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error("Unsafe SQL identifier");
  }
  return `"${value}"`;
}

function quoteQualifiedIdentifier(value: string): string {
  const [schema, relation] = parseQualifiedIdentifier(value, "SQL relation");
  return `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
}

function quoteLiteral(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error("Unsafe SQL literal");
  }
  return `'${value}'`;
}

export function buildRestoreVerificationQueries(manifest: RestoreManifest): {
  readonly relations: string;
  readonly migrations: readonly { owner: string; query: string }[];
  readonly counts: string;
} {
  const schemas = uniqueSorted(
    manifest.contributors.flatMap((contributor) => contributor.schemas),
    "Restore schemas",
  );
  const relations = `
    SELECT namespace.nspname AS schema_name, class.relname AS relation_name
    FROM pg_class AS class
    INNER JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname IN (${schemas.map(quoteLiteral).join(", ")})
      AND class.relkind IN ('r', 'p')
    ORDER BY namespace.nspname, class.relname
  `;
  const migrations = manifest.contributors.map((contributor) => ({
    owner: contributor.owner,
    query: `SELECT version, checksum FROM ${quoteQualifiedIdentifier(contributor.migrationLedger)} ORDER BY version`,
  }));
  const expectedRelations = manifest.contributors
    .flatMap((contributor) => contributor.relations)
    .sort();
  const counts = `SELECT ${expectedRelations
    .map(
      (relation, index) =>
        `(SELECT count(*)::text FROM ${quoteQualifiedIdentifier(relation)}) AS ${quoteIdentifier(`r${index}`)}`,
    )
    .join(", ")}`;
  return deepFreeze({ relations, migrations, counts });
}

function exactString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

async function collectRestoreSnapshot(
  transaction: RestoreSqlExecutor,
  source: RestoreManifestSource,
): Promise<RestoreVerificationResult> {
  const { manifest, sha256 } = source;
  const queries = buildRestoreVerificationQueries(manifest);
  const relationRows = await transaction.unsafe<{
    schema_name: unknown;
    relation_name: unknown;
  }>(queries.relations);
  const actualRelations = relationRows.map(
    (row, index) =>
      `${exactString(row.schema_name, `Relation ${index} schema`)}.${exactString(
        row.relation_name,
        `Relation ${index} name`,
      )}`,
  );
  const expectedRelations = manifest.contributors
    .flatMap((contributor) => contributor.relations)
    .sort();
  if (JSON.stringify(actualRelations) !== JSON.stringify(expectedRelations)) {
    throw new Error("Restore relation boundary mismatch");
  }

  const migrationEvidence: Array<{ owner: string; version: string; checksum: string }> = [];
  for (const migrationQuery of queries.migrations) {
    const contributor = manifest.contributors.find(
      (candidate) => candidate.owner === migrationQuery.owner,
    );
    if (!contributor) {
      throw new Error("Restore migration contributor is unavailable");
    }
    const rows = await transaction.unsafe<{ version: unknown; checksum: unknown }>(
      migrationQuery.query,
    );
    const actual = rows.map((row, index) => ({
      version: exactString(row.version, `${contributor.owner} migration ${index} version`),
      checksum: exactString(row.checksum, `${contributor.owner} migration ${index} checksum`),
    }));
    if (JSON.stringify(actual) !== JSON.stringify(contributor.migrations)) {
      throw new Error(`Restore migration boundary mismatch for ${contributor.owner}`);
    }
    migrationEvidence.push(
      ...actual.map((migration) => ({ owner: contributor.owner, ...migration })),
    );
  }

  const countRows = await transaction.unsafe<Record<string, unknown>>(queries.counts);
  if (countRows.length !== 1 || !countRows[0]) {
    throw new Error("Restore aggregate count query returned an invalid result");
  }
  const relationCounts = expectedRelations.map((relation, index) => {
    const count = countRows[0]?.[`r${index}`];
    if (typeof count !== "string" || !/^[0-9]+$/.test(count)) {
      throw new Error(`Restore aggregate count for ${relation} is invalid`);
    }
    return [relation, count] as const;
  });
  const aggregateDigest = createHash("sha256")
    .update(
      JSON.stringify({
        manifestId: manifest.manifestId,
        migrations: migrationEvidence,
        relationCounts,
      }),
    )
    .digest("hex");

  return deepFreeze({
    manifestId: manifest.manifestId,
    manifestSha256: sha256,
    ownerCount: manifest.contributors.length,
    relationCount: expectedRelations.length,
    migrationCount: migrationEvidence.length,
    aggregateDigest,
  });
}

export function buildRestoreVerificationEvent(
  result: RestoreVerificationResult,
): RestoreVerificationEvent {
  return deepFreeze({
    event: "d1_restore_verification",
    schema_version: 1,
    kind: "read_only_aggregate",
    manifest_id: result.manifestId,
    manifest_sha256: result.manifestSha256,
    owner_count: result.ownerCount,
    relation_count: result.relationCount,
    migration_count: result.migrationCount,
    digest: result.aggregateDigest,
  });
}

export async function verifyRestoreDatabase(
  client: RestoreSqlClient,
  source: RestoreManifestSource = loadCurrentRestoreManifest(),
): Promise<RestoreVerificationResult> {
  return client.begin("read only isolation level repeatable read", async (transaction) => {
    await transaction.unsafe(
      "SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '30s'",
    );
    const boundary = await transaction.unsafe<{
      transaction_read_only: unknown;
      statement_timeout_ms: unknown;
      lock_timeout_ms: unknown;
      idle_timeout_ms: unknown;
    }>(`
      SELECT
        current_setting('transaction_read_only') AS transaction_read_only,
        (EXTRACT(epoch FROM current_setting('statement_timeout')::interval) * 1000)::int::text
          AS statement_timeout_ms,
        (EXTRACT(epoch FROM current_setting('lock_timeout')::interval) * 1000)::int::text
          AS lock_timeout_ms,
        (
          EXTRACT(epoch FROM current_setting('idle_in_transaction_session_timeout')::interval) * 1000
        )::int::text AS idle_timeout_ms
    `);
    if (
      boundary.length !== 1 ||
      boundary[0]?.transaction_read_only !== "on" ||
      boundary[0]?.statement_timeout_ms !== "15000" ||
      boundary[0]?.lock_timeout_ms !== "2000" ||
      boundary[0]?.idle_timeout_ms !== "30000"
    ) {
      throw new Error("Restore transaction safety boundary mismatch");
    }
    return collectRestoreSnapshot(transaction, source);
  });
}
