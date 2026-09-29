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
  type RestoreSqlClient,
  type RestoreSqlExecutor,
  verifyRestoreDatabase,
} from "./restore-verifier.js";

function expectedRelations(source: RestoreManifestSource): string[] {
  return source.manifest.contributors.flatMap((contributor) => contributor.relations).sort();
}

function successfulExecutor(source: RestoreManifestSource, count = "0"): RestoreSqlExecutor {
  const relations = expectedRelations(source);
  const schemas = [
    ...source.manifest.contributors.flatMap((contributor) => contributor.schemas),
    "public",
  ].sort();
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
      if (query.includes("FROM pg_namespace AS namespace")) {
        return schemas.map((schema_name) => ({ schema_name }) as unknown as T);
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
  it("binds the exact Phase 3 Profile, Jobs, Documents, Matching, Billing, Trust, and Applications bytes", async () => {
    const source = loadCurrentRestoreManifest();

    expect(source.manifest.manifestId).toBe(
      "d3-application-lifecycle-profile-jobs-documents-matching-billing-trust-applications-v1",
    );
    expect(source.manifest.contributors.map((contributor) => contributor.owner)).toEqual([
      "applications",
      "billing",
      "documents",
      "jobs",
      "matching",
      "profile",
      "trust",
    ]);
    expect([...migrationRunners].map((runner) => runner.owner).sort()).toEqual(
      source.manifest.contributors.map((contributor) => contributor.owner),
    );
    expect(expectedRelations(source)).toHaveLength(78);
    expect(
      source.manifest.contributors.reduce(
        (total, contributor) => total + contributor.migrations.length,
        0,
      ),
    ).toBe(52);
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);

    // The exact six-owner assertion above bounds I/O concurrency. Each owner still enumerates
    // every SQL file and checks every checksum sequentially, including under full-workspace load.
    await Promise.all(
      source.manifest.contributors.map(async (contributor) => {
        const migrationDirectory = new URL(
          `../../${contributor.owner}/migrations/`,
          import.meta.url,
        );
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
      }),
    );
  }, 15_000);

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

    const extended = createRestoreManifest(source.manifest, [future], "d2-with-future-v1");

    expect(extended.contributors.map((contributor) => contributor.owner)).toEqual([
      "applications",
      "billing",
      "documents",
      "jobs",
      "matching",
      "profile",
      "recommendations",
      "trust",
    ]);
    expect(source.manifest.contributors).toHaveLength(7);
    expect(JSON.stringify(source.manifest.contributors)).toBe(existingContributors);
    expect(
      extended.contributors.filter((contributor) => contributor.owner !== "recommendations"),
    ).toEqual(source.manifest.contributors);
    expect(Object.isFrozen(extended)).toBe(true);
    expect(Object.isFrozen(extended.contributors)).toBe(true);
    expect(Object.isFrozen(extended.contributors[5]?.migrations)).toBe(true);
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
      manifestId:
        "d3-application-lifecycle-profile-jobs-documents-matching-billing-trust-applications-v1",
      manifestSha256: source.sha256,
      ownerCount: 7,
      relationCount: 78,
      migrationCount: 52,
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
      queries.schemas,
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

  it.each(["missing", "wrong checksum"])(
    "rejects %s Trust accepted-independent-evidence migration at the current boundary",
    async (mutation) => {
      const source = loadCurrentRestoreManifest();
      const baseline = successfulExecutor(source);
      const executor: RestoreSqlExecutor = {
        async unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> {
          const rows = await baseline.unsafe<T>(query);
          if (!query.includes('"trust"."schema_migrations"')) {
            return rows;
          }
          expect(rows.some((row) => row.version === "0004_accepted_independent_evidence")).toBe(
            true,
          );
          return rows.flatMap((row) =>
            row.version !== "0004_accepted_independent_evidence"
              ? [row]
              : mutation === "missing"
                ? []
                : [{ ...row, checksum: "f".repeat(64) }],
          ) as T[];
        },
      };
      await expect(
        verifyRestoreDatabase(
          {
            async begin(_options, work) {
              return work(executor);
            },
          },
          source,
        ),
      ).rejects.toThrow("migration boundary mismatch for trust");
    },
  );

  it.each([
    {
      migrationCount: 41,
      omittedVersions: [
        "0024_contribution_appeal_restoration",
        "0022_development_contribution_provider_leases",
        "0005_development_test_removal",
        "0023_contribution_verification_refresh",
        "0004_accepted_independent_evidence",
        "0004_resume_deletion",
        "0005_resume_purge",
      ],
    },
    {
      migrationCount: 42,
      omittedVersions: [
        "0024_contribution_appeal_restoration",
        "0023_contribution_verification_refresh",
        "0005_development_test_removal",
        "0004_accepted_independent_evidence",
        "0004_resume_deletion",
        "0005_resume_purge",
      ],
    },
  ])(
    "keeps the prior $migrationCount-migration release verifiable only against its own boundary",
    async ({ migrationCount, omittedVersions }) => {
      const current = loadCurrentRestoreManifest();
      const historicalManifest = parseRestoreManifest({
        ...current.manifest,
        contributors: current.manifest.contributors.map((contributor) => ({
          ...contributor,
          migrations: contributor.migrations.filter(
            (migration) => !omittedVersions.includes(migration.version),
          ),
        })),
      });
      const historical: RestoreManifestSource = {
        manifest: historicalManifest,
        sha256: createHash("sha256").update(JSON.stringify(historicalManifest)).digest("hex"),
      };
      const executor = successfulExecutor(historical);
      const client: RestoreSqlClient = {
        async begin(_options, work) {
          return work(executor);
        },
      };

      expect(historical.sha256).not.toBe(current.sha256);
      await expect(verifyRestoreDatabase(client, historical)).resolves.toMatchObject({
        manifestSha256: historical.sha256,
        ownerCount: 7,
        relationCount: 78,
        // Applications' three migrations and Profile 0010 are part of both derived boundaries;
        // Jobs, Documents 0004, and Trust differ.
        migrationCount: migrationCount + 4,
      });
      // Documents (0004), Jobs, and Trust all differ; the first owner checked is the one reported.
      await expect(verifyRestoreDatabase(client, current)).rejects.toThrow(
        /migration boundary mismatch for (documents|jobs)/,
      );
    },
  );

  it("rejects a missing owned schema even when that schema contains no relations", async () => {
    const source = loadCurrentRestoreManifest();
    const baseline = successfulExecutor(source);
    const missingSchemaExecutor: RestoreSqlExecutor = {
      async unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> {
        const rows = await baseline.unsafe<T>(query);
        if (query.includes("FROM pg_namespace AS namespace")) {
          return rows.filter((row) => row.schema_name !== "jobs_public");
        }
        return rows;
      },
    };

    await expect(
      verifyRestoreDatabase(
        {
          async begin(_options, work) {
            return work(missingSchemaExecutor);
          },
        },
        source,
      ),
    ).rejects.toThrow("schema boundary mismatch");
  });

  it("rejects an unexpected non-system schema and a relation in permitted public", async () => {
    const source = loadCurrentRestoreManifest();
    const baseline = successfulExecutor(source);
    const extraSchemaExecutor: RestoreSqlExecutor = {
      async unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> {
        const rows = await baseline.unsafe<T>(query);
        if (query.includes("FROM pg_namespace AS namespace")) {
          return [...rows, { schema_name: "restore_verifier_unreviewed" } as unknown as T];
        }
        return rows;
      },
    };
    await expect(
      verifyRestoreDatabase(
        {
          async begin(_options, work) {
            return work(extraSchemaExecutor);
          },
        },
        source,
      ),
    ).rejects.toThrow("schema boundary mismatch");

    const publicRelationExecutor: RestoreSqlExecutor = {
      async unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]> {
        if (query.includes("FROM pg_class AS class")) {
          const rows = await baseline.unsafe<T>(query);
          return [
            ...rows,
            { schema_name: "public", relation_name: "unreviewed_table" } as unknown as T,
          ];
        }
        return baseline.unsafe<T>(query);
      },
    };
    await expect(
      verifyRestoreDatabase(
        {
          async begin(_options, work) {
            return work(publicRelationExecutor);
          },
        },
        source,
      ),
    ).rejects.toThrow("relation boundary mismatch");
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
