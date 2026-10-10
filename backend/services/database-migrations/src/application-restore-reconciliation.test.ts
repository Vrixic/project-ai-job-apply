import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { restoreCatalogFixture } from "./application-restore-catalog.fixture.js";
import { reconcileApplicationRestore } from "./application-restore-reconciliation.js";
import {
  collectRestoreDataInventory,
  type RestoreDataInventory,
} from "./restore-data-inventory.js";
import {
  loadCurrentRestoreManifest,
  type RestoreManifestSource,
  type RestoreSqlClient,
} from "./restore-verifier.js";

vi.mock("./restore-data-inventory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./restore-data-inventory.js")>()),
  collectRestoreDataInventory: vi.fn(),
}));
const current = loadCurrentRestoreManifest();
const columns = Object.fromEntries(
  Object.entries(restoreCatalogFixture).map(([version, tables]) => [
    version,
    Object.fromEntries(
      Object.entries(tables).map(([relation, shape]) => [
        relation,
        shape.map(([name, type, notNull]: readonly [string, string, boolean]) => ({
          name,
          type,
          notNull,
          identity: "",
          generated: "",
        })),
      ]),
    ),
  ]),
) as Record<
  "original" | "restored",
  Record<string, RestoreDataInventory["relations"][number]["columns"]>
>;
const oldSource: RestoreManifestSource = {
  sha256: "1a67ddc33ab3fa2bd84cce4a3d452728a90f8ee755c04b953c13ca5ba8aefb3b",
  manifest: {
    ...current.manifest,
    manifestId: "d3-latest-pretransition-applications-three-v1",
    contributors: current.manifest.contributors.map((owner) =>
      owner.owner === "applications"
        ? {
            ...owner,
            schemas: ["applications"],
            migrations: owner.migrations.slice(0, 3),
            relations: [
              "applications",
              "approvals",
              "attempts",
              "command_receipts",
              "history",
              "outbox",
              "packets",
              "schema_migrations",
            ].map((name) => `applications.${name}`),
          }
        : owner,
    ),
  },
};
const refused = /^ApplicationRestoreReconciliationFailed$/;
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(collectRestoreDataInventory).mockReset();
});
function present<T>(value: T | undefined): T {
  if (value === undefined) throw Error("MissingSyntheticFixture");
  return value;
}
function fixture() {
  let transactions = 0,
    enabled = true,
    invalid = "0",
    ledger = { count: "12", instants: "1", in_window: true };
  const queries: string[] = [];
  const inventory = (source: RestoreManifestSource, archived: boolean): RestoreDataInventory => {
    const body = {
      schemaVersion: 1 as const,
      serializer: "postgres16-jsonb-whole-row-sha256-v1" as const,
      manifestSha256: source.sha256,
      relations: source.manifest.contributors
        .flatMap((owner) => owner.relations)
        .sort()
        .map((relation) => ({
          relation,
          columns: structuredClone(
            columns[archived ? "restored" : "original"][relation] ?? [
              { name: "id", type: "uuid", notNull: true, identity: "", generated: "" },
            ],
          ),
          rowCount: relation === "applications_restricted.legacy_receipts" ? 7 : 0,
          byteCount: 0,
          rowDigest: "a".repeat(64),
        })),
    };
    return { ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
  };
  const inventories = { original: inventory(oldSource, false), restored: inventory(current, true) };
  const rehash = () => {
    for (const value of Object.values(inventories)) {
      const { digest: _, ...body } = value;
      Object.assign(value, {
        digest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
      });
    }
  };
  vi.mocked(collectRestoreDataInventory).mockImplementation(async (client, source = current) => {
    await client.begin("read only isolation level repeatable read", async (tx) => {
      await tx.unsafe("inventory-delegated");
    });
    rehash();
    return structuredClone(
      source.sha256 === oldSource.sha256 ? inventories.original : inventories.restored,
    );
  });
  let onQuery = (_query: string) => {};
  const makeClient = (): RestoreSqlClient => ({
    async begin(_options, work) {
      transactions++;
      try {
        return await work({
          unsafe: async <T extends Record<string, unknown>>(query: string) => {
            queries.push(query);
            onQuery(query);
            const rows = query.includes(" AS invalid")
              ? [{ invalid }]
              : query.includes(" AS instants")
                ? [ledger]
                : query === "inventory-delegated"
                  ? []
                  : [{ count: "0", bytes: "0", digest: "a".repeat(64) }];
            return rows as unknown as T[];
          },
        });
      } finally {
        transactions--;
      }
    },
  });
  const oldClient = makeClient(),
    newClient = makeClient();
  const verifyReceipts = vi.fn(
    async (_old: RestoreSqlClient, _new: RestoreSqlClient, admission: () => void) => {
      expect(transactions).toBe(0);
      admission();
      return { matchedReceipts: 7 as const };
    },
  );
  const options = {
    originalSource: structuredClone(oldSource),
    transitionStartedAt: "2026-01-01T00:00:00.000Z",
    transitionEndedAt: "2026-01-01T00:01:00.000Z",
    enabled: () => enabled,
    verifyReceipts,
  };
  return {
    inventories,
    options,
    queries,
    verifyReceipts,
    run: () => reconcileApplicationRestore(oldClient, newClient, options),
    revoke: () => {
      enabled = false;
    },
    onQuery: (callback: typeof onQuery) => {
      onQuery = callback;
    },
    invalidateDefaults: () => {
      invalid = "1";
    },
    setLedger: (value: typeof ledger) => {
      ledger = value;
    },
  };
}
it("reconciles the closed contract and returns aggregate diagnostic authority only", async () => {
  const f = fixture(),
    result = await f.run();
  expect(result).toMatchObject({
    commonRelations: 88,
    addedTables: 8,
    addedMigrations: 12,
    matchedLegacyReceipts: 7,
    transitionReconciled: true,
    privacyReplayAccepted: false,
    primaryPromotionAuthorized: false,
  });
  expect(f.verifyReceipts).toHaveBeenCalledTimes(1);
  expect(collectRestoreDataInventory).toHaveBeenCalledTimes(4);
});
it.each(["sha256", "manifestId", "schema", "ledger", "migration", "owner"])(
  "refuses a changed %s manifest before SQL",
  async (field) => {
    const f = fixture(),
      source = f.options.originalSource;
    if (field === "sha256") Object.assign(source, { sha256: "f".repeat(64) });
    if (field === "manifestId") Object.assign(source.manifest, { manifestId: "other" });
    if (field === "schema")
      Object.assign(present(source.manifest.contributors[0]), { schemas: ["other"] });
    if (field === "ledger")
      Object.assign(present(source.manifest.contributors[0]), {
        migrationLedger: "applications.other",
      });
    if (field === "migration")
      Object.assign(present(present(source.manifest.contributors[0]).migrations[0]), {
        checksum: "f".repeat(64),
      });
    if (field === "owner")
      Object.assign(present(source.manifest.contributors[0]), { owner: "other" });
    await expect(f.run()).rejects.toThrow(refused);
    expect(f.queries).toHaveLength(0);
  },
);
it.each([
  "profile.restricted_answers",
  "privacy.account_deletion_ledger",
  "profile.ugc_contribution_consents",
  "applications.history",
])("never normalizes changed %s data", async (relation) => {
  const f = fixture();
  Object.assign(
    present(f.inventories.restored.relations.find((row) => row.relation === relation)),
    {
      rowDigest: "b".repeat(64),
    },
  );
  await expect(f.run()).rejects.toThrow(refused);
  expect(f.verifyReceipts).not.toHaveBeenCalled();
});
it.each(["type", "notNull", "identity", "generated"])(
  "refuses identical corruption of original and restored %s column metadata",
  async (field) => {
    const f = fixture();
    for (const inventory of Object.values(f.inventories)) {
      const col = present(
        present(inventory.relations.find((row) => row.relation === "applications.packets"))
          .columns[0],
      );
      Object.assign(col, {
        [field]: field === "notNull" ? false : field === "type" ? "text" : "s",
      });
    }
    await expect(f.run()).rejects.toThrow(refused);
  },
);
it.each(Object.keys(columns.restored).filter((name) => !(name in columns.original)))(
  "refuses an extra column in %s",
  async (relation) => {
    const f = fixture(),
      row = present(f.inventories.restored.relations.find((row) => row.relation === relation));
    Object.assign(row, {
      columns: [
        ...row.columns,
        { name: "unreconciled", type: "text", notNull: false, identity: "", generated: "" },
      ],
    });
    await expect(f.run()).rejects.toThrow(refused);
    expect(f.verifyReceipts).not.toHaveBeenCalled();
  },
);
it("refuses non-default added values and a non-atomic or unbound ledger timestamp", async () => {
  const f = fixture();
  f.invalidateDefaults();
  await expect(f.run()).rejects.toThrow(refused);
  for (const ledger of [
    { count: "11", instants: "1", in_window: true },
    { count: "12", instants: "2", in_window: true },
    { count: "12", instants: "1", in_window: false },
  ]) {
    const f = fixture();
    f.setLedger(ledger);
    await expect(f.run()).rejects.toThrow(refused);
  }
});
it("detects mutation of any full inventory after crypto", async () => {
  const f = fixture();
  f.verifyReceipts.mockImplementationOnce(async () => {
    Object.assign(present(f.inventories.original.relations[0]), { rowDigest: "b".repeat(64) });
    return { matchedReceipts: 7 };
  });
  await expect(f.run()).rejects.toThrow(refused);
});
it("withdrawal during delegated inventory SQL prevents the next operation", async () => {
  const f = fixture();
  f.onQuery(() => f.revoke());
  await expect(f.run()).rejects.toThrow(refused);
  expect(f.queries).toEqual(["inventory-delegated"]);
});
it("the overall deadline interrupts nested inventory admission before the next SQL", async () => {
  const f = fixture();
  let expired = false;
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => (expired ? 120_000_000_000n : 0n));
  f.onQuery(() => {
    expired = true;
  });
  await expect(f.run()).rejects.toThrow(refused);
  expect(f.queries).toEqual(["inventory-delegated"]);
});
it("shared admission rejects another decrypt when the overall deadline expires", async () => {
  const f = fixture();
  let expired = false;
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => (expired ? 120_000_000_000n : 0n));
  f.verifyReceipts.mockImplementationOnce(async (_old, _new, admission) => {
    expired = true;
    admission();
    return { matchedReceipts: 7 };
  });
  await expect(f.run()).rejects.toThrow(refused);
  expect(collectRestoreDataInventory).toHaveBeenCalledTimes(2);
});
