import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { migrationRunners } from "./index.js";
import {
  buildRestoreVerificationEvent,
  buildRestoreVerificationQueries,
  createRestoreManifest,
  loadCurrentRestoreManifest,
  parseRestoreManifest,
  type RestoreContributor,
  type RestoreManifestSource,
  type RestoreSqlExecutor,
  verifyRestoreDatabase,
} from "./restore-verifier.js";

function expectedRelations(source: RestoreManifestSource): string[] {
  return source.manifest.contributors.flatMap((contributor) => contributor.relations).sort();
}

function successfulExecutor(source: RestoreManifestSource, count = "0"): RestoreSqlExecutor {
  const relations = expectedRelations(source);
  return {
    async unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> {
      if (query.startsWith("SET LOCAL ")) {
        return [];
      }
      if (query.includes("current_setting('transaction_read_only')")) {
        return [
          {
            transaction_read_only: "on",
            statement_timeout_ms: "15000",
            lock_timeout_ms: "2000",
            idle_timeout_ms: "30000",
          } as unknown as T,
        ];
      }
      if (query.includes("FROM pg_class AS class")) {
        return relations.map((relation) => {
          const [schema_name, relation_name] = relation.split(".");
          if (!schema_name || !relation_name) {
            throw new Error("Invalid test relation");
          }
          return { schema_name, relation_name } as unknown as T;
        });
      }
      if (query.trimStart().startsWith("SELECT (SELECT count(*)::text")) {
        return [
          Object.fromEntries(
            relations.map((_relation, index) => [`r${index}`, count]),
          ) as unknown as T,
        ];
      }
      const contributor = source.manifest.contributors.find((candidate) =>
        query.includes(
          candidate.migrationLedger
            .split(".")
            .map((identifier) => `"${identifier}"`)
            .join("."),
        ),
      );
      if (contributor) {
        return contributor.migrations.map((migration) => ({ ...migration }) as unknown as T);
      }
      throw new Error("Unexpected verification query");
    },
  };
}

describe("current restore manifest", () => {
  it("binds the exact current Profile, Jobs, Documents, Matching, and Billing bytes", async () => {
    const source = loadCurrentRestoreManifest();

    expect(source.manifest.manifestId).toBe("d1-profile-jobs-documents-matching-billing-v1");
    expect(source.manifest.contributors.map((contributor) => contributor.owner)).toEqual([
      "billing",
      "documents",
      "jobs",
      "matching",
      "profile",
    ]);
    expect([...migrationRunners].map((runner) => runner.owner).sort()).toEqual(
      source.manifest.contributors.map((contributor) => contributor.owner),
    );
    expect(expectedRelations(source)).toHaveLength(36);
    expect(
      source.manifest.contributors.reduce(
        (total, contributor) => total + contributor.migrations.length,
        0,
      ),
    ).toBe(13);
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);

    for (const contributor of source.manifest.contributors) {
      const migrationDirectory = new URL(`../../${contributor.owner}/migrations/`, import.meta.url);
      expect(
        (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort(),
      ).toEqual(contributor.migrations.map((migration) => `${migration.version}.sql`));
      for (const migration of contributor.migrations) {
        const bytes = (
          await readFile(
            new URL(
              `../../${contributor.owner}/migrations/${migration.version}.sql`,
              import.meta.url,
            ),
            "utf8",
          )
        ).replaceAll("\r\n", "\n");
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(migration.checksum);
      }
    }
  });

  it("is recursively immutable and accepts a separate additive owner", () => {
    const source = loadCurrentRestoreManifest();
    const existingContributors = JSON.stringify(source.manifest.contributors);
    const future = {
      owner: "recommendations",
      schemas: ["recommendations"],
      migrationLedger: "recommendations.schema_migrations",
      migrations: [{ version: "0001_foundation", checksum: "a".repeat(64) }],
      relations: ["recommendations.schema_migrations"],
    } satisfies RestoreContributor;

    const extended = createRestoreManifest(source.manifest, [future], "d1-with-future-v1");

    expect(extended.contributors.map((contributor) => contributor.owner)).toEqual([
      "billing",
      "documents",
      "jobs",
      "matching",
      "profile",
      "recommendations",
    ]);
    expect(source.manifest.contributors).toHaveLength(5);
    expect(JSON.stringify(source.manifest.contributors)).toBe(existingContributors);
    expect(extended.contributors.slice(0, 5)).toEqual(source.manifest.contributors);
    expect(Object.isFrozen(extended)).toBe(true);
    expect(Object.isFrozen(extended.contributors)).toBe(true);
    expect(Object.isFrozen(extended.contributors[4]?.migrations)).toBe(true);
  });

  it.each([
    [
      "extra top-level key",
      { schemaVersion: 1, manifestId: "test", contributors: [], extra: true },
    ],
    [
      "noncanonical migration ordering",
      {
        schemaVersion: 1,
        manifestId: "test",
        contributors: [
          {
            owner: "profile",
            schemas: ["profile"],
            migrationLedger: "profile.schema_migrations",
            migrations: [
              { version: "0002_second", checksum: "b".repeat(64) },
              { version: "0001_first", checksum: "a".repeat(64) },
            ],
            relations: ["profile.schema_migrations"],
          },
        ],
      },
    ],
    [
      "unsafe relation",
      {
        schemaVersion: 1,
        manifestId: "test",
        contributors: [
          {
            owner: "profile",
            schemas: ["profile"],
            migrationLedger: "profile.schema_migrations",
            migrations: [{ version: "0001_test", checksum: "a".repeat(64) }],
            relations: ["profile.schema_migrations", "profile.users;DROP_TABLE"],
          },
        ],
      },
    ],
    [
      "duplicate schema ownership",
      {
        schemaVersion: 1,
        manifestId: "test",
        contributors: [
          {
            owner: "one",
            schemas: ["shared"],
            migrationLedger: "shared.schema_migrations",
            migrations: [{ version: "0001_test", checksum: "a".repeat(64) }],
            relations: ["shared.schema_migrations"],
          },
          {
            owner: "two",
            schemas: ["shared"],
            migrationLedger: "shared.other_migrations",
            migrations: [{ version: "0001_test", checksum: "b".repeat(64) }],
            relations: ["shared.other_migrations"],
          },
        ],
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseRestoreManifest(value)).toThrow();
  });
});

describe("read-only aggregate restore verification", () => {
  it("uses one repeatable-read transaction and returns only aggregate evidence", async () => {
    const source = loadCurrentRestoreManifest();
    const executor = successfulExecutor(source, "731");
    const transactionModes: string[] = [];
    const result = await verifyRestoreDatabase(
      {
        async begin(options, work) {
          transactionModes.push(options);
          return work(executor);
        },
      },
      source,
    );

    expect(transactionModes).toEqual(["read only isolation level repeatable read"]);
    expect(result).toMatchObject({
      manifestId: "d1-profile-jobs-documents-matching-billing-v1",
      manifestSha256: source.sha256,
      ownerCount: 5,
      relationCount: 36,
      migrationCount: 13,
    });
    expect(result.aggregateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(result)).toEqual([
      "manifestId",
      "manifestSha256",
      "ownerCount",
      "relationCount",
      "migrationCount",
      "aggregateDigest",
    ]);
    expect(Object.keys(buildRestoreVerificationEvent(result))).toEqual([
      "event",
      "schema_version",
      "kind",
      "manifest_id",
      "manifest_sha256",
      "owner_count",
      "relation_count",
      "migration_count",
      "digest",
    ]);
  });

  it("builds SELECT-only SQL from the validated manifest", () => {
    const queries = buildRestoreVerificationQueries(loadCurrentRestoreManifest().manifest);
    const statements = [
      queries.relations,
      ...queries.migrations.map((item) => item.query),
      queries.counts,
    ];

    for (const statement of statements) {
      expect(statement.trimStart()).toMatch(/^SELECT\b/);
      expect(statement).not.toMatch(
        /\b(?:ALTER|COPY|CREATE|DELETE|DROP|GRANT|INSERT|LOCK|REVOKE|TRUNCATE|UPDATE)\b/i,
      );
    }
  });

  it("rejects extra relations and any migration checksum mismatch", async () => {
    const source = loadCurrentRestoreManifest();
    const baseline = successfulExecutor(source);
    const relations = expectedRelations(source);
    const extraRelationExecutor: RestoreSqlExecutor = {
      async unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> {
        if (query.includes("FROM pg_class AS class")) {
          return [
            ...relations.map((relation) => {
              const [schema_name, relation_name] = relation.split(".");
              if (!schema_name || !relation_name) {
                throw new Error("Invalid test relation");
              }
              return { schema_name, relation_name } as unknown as T;
            }),
            { schema_name: "jobs", relation_name: "unreviewed_table" } as unknown as T,
          ];
        }
        return baseline.unsafe<T>(query);
      },
    };
    await expect(
      verifyRestoreDatabase(
        {
          async begin(_options, work) {
            return work(extraRelationExecutor);
          },
        },
        source,
      ),
    ).rejects.toThrow("relation boundary mismatch");

    const checksumExecutor: RestoreSqlExecutor = {
      async unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> {
        const rows = await baseline.unsafe<T>(query);
        if (query.includes('"jobs"."schema_migrations"') && rows[0]) {
          return [{ ...rows[0], checksum: "f".repeat(64) }, ...rows.slice(1)] as T[];
        }
        return rows;
      },
    };
    await expect(
      verifyRestoreDatabase(
        {
          async begin(_options, work) {
            return work(checksumExecutor);
          },
        },
        source,
      ),
    ).rejects.toThrow("migration boundary mismatch for jobs");
  });

  it("changes the digest when aggregate counts differ", async () => {
    const source = loadCurrentRestoreManifest();
    const verifyWithCount = (count: string) =>
      verifyRestoreDatabase(
        {
          async begin(_options, work) {
            return work(successfulExecutor(source, count));
          },
        },
        source,
      );

    const first = await verifyWithCount("0");
    const second = await verifyWithCount("1");
    expect(first.aggregateDigest).not.toBe(second.aggregateDigest);
  });
});
