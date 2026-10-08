import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { PostgresJobModerationStore } from "./reporting.js";

const source = {
  kind: "source" as const,
  sourceId: "synthetic-foundation-v1",
  adapterVersion: "synthetic-ingestion-v1",
  adapterConfigSha256: "c".repeat(64),
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "01a0324a-b0dc-77dd-ac95-71f8873fe5ef",
    targetKind: "source",
    jobId: null,
    sourceId: source.sourceId,
    adapterVersion: source.adapterVersion,
    adapterConfigSha256: source.adapterConfigSha256,
    status: "open",
    resolution: null,
    version: 0,
    openedBy: `oidc:${"a".repeat(64)}`,
    openReasonCode: "source_integrity",
    openedAt: "2026-08-24 05:42:30.979+00",
    resolvedBy: null,
    resolutionReasonCode: null,
    resolvedAt: null,
    ...overrides,
  };
}

function clientWithRows(...rows: Record<string, unknown>[]): postgres.Sql {
  let index = 0;
  const query = (() => Promise.resolve([rows[index++]])) as unknown as postgres.Sql;
  Object.assign(query, {
    begin: async (callback: (transaction: postgres.Sql) => unknown) => callback(query),
  });
  return query;
}

describe("moderation persistence timestamp projection", () => {
  it("refuses absent or malformed pause state instead of granting source execution", async () => {
    for (const value of [undefined, "false", null, 0]) {
      const moderation = new PostgresJobModerationStore(clientWithRows({ paused: value }));
      await expect(moderation.isSourcePaused(source)).rejects.toThrow(
        "source pause state is unavailable",
      );
    }
  });
  it("normalizes PostgreSQL timestamp strings returned by bundled runtimes", async () => {
    const resolved = row({
      status: "resolved",
      resolution: "pause_source",
      version: 1,
      resolvedBy: `oidc:${"b".repeat(64)}`,
      resolutionReasonCode: "source_integrity_failure",
      resolvedAt: "2026-08-24 06:02:16.661+00",
    });
    const store = new PostgresJobModerationStore(clientWithRows(row(), resolved));

    await expect(
      store.resolveCase({
        caseId: String(resolved.id),
        expectedVersion: 0,
        resolution: "pause_source",
        operatorId: `oidc:${"b".repeat(64)}`,
        reasonCode: "source_integrity_failure",
      }),
    ).resolves.toMatchObject({
      openedAt: "2026-08-24T05:42:30.979Z",
      resolvedAt: "2026-08-24T06:02:16.661Z",
    });
  });

  it("continues to project native Date values and rejects malformed strings", async () => {
    const native = new PostgresJobModerationStore(
      clientWithRows(row({ openedAt: new Date("2026-08-24T05:42:30.979Z") })),
    );
    await expect(
      native.openCase({
        target: source,
        operatorId: "operator:test",
        reasonCode: "source_integrity",
      }),
    ).resolves.toMatchObject({ openedAt: "2026-08-24T05:42:30.979Z" });

    const malformed = new PostgresJobModerationStore(
      clientWithRows(row({ openedAt: "not-a-date" })),
    );
    await expect(
      malformed.openCase({
        target: source,
        operatorId: "operator:test",
        reasonCode: "source_integrity",
      }),
    ).rejects.toThrow("The persisted moderation timestamp is malformed");
  });
});
