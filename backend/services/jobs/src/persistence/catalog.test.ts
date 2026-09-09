import { createHmac } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  type CatalogObservation,
  ConflictingObservationError,
  PostgresJobCatalog,
} from "./catalog.js";

const catalogOptions = {
  searchCursorKeys: { active: { id: "test-v1", key: Buffer.alloc(32, 1) } },
} as const;

describe("PostgresJobCatalog observation ordering", () => {
  const jobId = "00000000-0000-7000-8000-000000000001";
  const sourceId = "00000000-0000-7000-8000-000000000002";
  const instant = (day: number) => new Date(`2026-08-${String(day).padStart(2, "0")}T12:00:00Z`);
  const observation: CatalogObservation = {
    provider: "greenhouse",
    provenance: "authorized_fixture",
    companyName: "Synthetic Ordering Company",
    title: "Synthetic Engineer",
    description: "Independent synthetic provider observation.",
    locations: ["Remote - US"],
    sourceUrl: "https://jobs.example.test/synthetic-ordering",
    atsTenant: "synthetic-ordering",
    externalJobId: "synthetic-posting",
    observedAt: instant(12),
  };

  it.each([
    {
      name: "older than source verification",
      sourceDay: 13,
      canonicalDay: 13,
      source: false,
      canonical: false,
    },
    {
      name: "newer than both verification clocks",
      sourceDay: 11,
      canonicalDay: 11,
      source: true,
      canonical: true,
    },
    {
      name: "equal repeated observation",
      sourceDay: 12,
      canonicalDay: 12,
      source: false,
      canonical: false,
    },
    {
      name: "equal source clock with conflicting evidence",
      sourceDay: 12,
      canonicalDay: 11,
      sourceMatches: false,
      conflict: true,
      source: false,
      canonical: false,
    },
    {
      name: "equal canonical clock with conflicting independent source evidence",
      sourceDay: 11,
      canonicalDay: 12,
      canonicalMatches: false,
      conflict: true,
      source: false,
      canonical: false,
    },
    {
      name: "equal canonical clock with matching independent source evidence",
      sourceDay: 11,
      canonicalDay: 12,
      source: true,
      canonical: false,
    },
    {
      name: "fresh alias source behind canonical clock",
      sourceDay: 11,
      canonicalDay: 13,
      source: true,
      canonical: false,
    },
    {
      name: "source withdrawal at the same instant",
      sourceDay: 12,
      canonicalDay: 11,
      withdrawnDay: 12,
      source: false,
      canonical: false,
    },
    {
      name: "source withdrawal after observation",
      sourceDay: 13,
      canonicalDay: 11,
      withdrawnDay: 13,
      source: false,
      canonical: false,
    },
    {
      name: "later bookkeeping timestamps do not suppress independent verification",
      sourceDay: 11,
      canonicalDay: 11,
      sourceUpdatedDay: 13,
      canonicalUpdatedDay: 13,
      source: true,
      canonical: true,
    },
    {
      name: "newer canonical lifecycle disposition",
      sourceDay: 11,
      canonicalDay: 11,
      status: "expired",
      statusChangedDay: 13,
      source: true,
      canonical: false,
    },
  ])("fences $name", async (scenario) => {
    const statements: string[] = [];
    const transaction = Object.assign(
      async (parts: TemplateStringsArray) => {
        const query = parts.join("?").replace(/\s+/g, " ").trim();
        statements.push(query);
        if (query.startsWith("SELECT pg_advisory_xact_lock")) return [];
        if (query.startsWith('SELECT job_id AS "jobId", id AS "sourceId"')) {
          return [{ jobId, sourceId }];
        }
        if (query.startsWith("WITH RECURSIVE resolution")) return [{ id: jobId }];
        if (query.includes('last_observed_at AS "lastObservedAt"')) {
          return [
            {
              id: sourceId,
              lastObservedAt: instant(scenario.sourceDay),
              lastVerifiedAt: instant(scenario.sourceDay),
              updatedAt: instant(scenario.sourceUpdatedDay ?? scenario.sourceDay),
              withdrawnAt: scenario.withdrawnDay ? instant(scenario.withdrawnDay) : null,
              observationMatches: scenario.sourceMatches ?? true,
            },
          ];
        }
        if (query.includes("FROM jobs.canonical_jobs")) {
          return [
            {
              id: jobId,
              companyId: jobId,
              title: observation.title,
              locations: observation.locations,
              description: observation.description,
              status: scenario.status ?? "active",
              statusReason: "positive_verification",
              firstObservedAt: instant(1),
              lastVerifiedAt: instant(scenario.canonicalDay),
              updatedAt: instant(scenario.canonicalUpdatedDay ?? scenario.canonicalDay),
              statusChangedAt: instant(scenario.statusChangedDay ?? 1),
              observationMatches: scenario.canonicalMatches ?? true,
              expiresAt: instant(31),
              consecutiveVerificationFailures: 0,
            },
          ];
        }
        if (query.startsWith("UPDATE jobs.")) return [];
        throw new Error("Unexpected synthetic catalog query");
      },
      { json: (value: unknown) => value, array: (value: unknown) => value },
    ) as unknown as postgres.TransactionSql;
    const catalog = new PostgresJobCatalog({} as postgres.Sql, catalogOptions);
    const result = catalog.recordObservationInTransaction(transaction, observation);
    if (scenario.conflict) {
      await expect(result).rejects.toBeInstanceOf(ConflictingObservationError);
    } else {
      await expect(result).resolves.toMatchObject({
        outcome: "exact_match_updated",
        job: { id: jobId },
      });
    }
    expect(statements.some((query) => query.startsWith("UPDATE jobs.job_sources"))).toBe(
      scenario.source,
    );
    expect(statements.some((query) => query.startsWith("UPDATE jobs.canonical_jobs"))).toBe(
      scenario.canonical,
    );
    expect(statements.some((query) => query.startsWith("INSERT"))).toBe(false);
  });
});

describe("PostgresJobCatalog active read parameters", () => {
  it("returns only the opaque catalog revision used to invalidate dependent read cursors", async () => {
    const client = (() => Promise.resolve([{ revision: "17" }])) as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client, catalogOptions);

    await expect(catalog.getCatalogRevision()).resolves.toBe("17");
  });

  it("binds the freshness boundary as an ISO string for the bundled PostgreSQL client", async () => {
    const parameters: unknown[][] = [];
    const client = ((_: TemplateStringsArray, ...values: unknown[]) => {
      parameters.push(values);
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client, catalogOptions);
    const jobId = "00000000-0000-7000-8000-000000000000";
    const activeAt = new Date("2026-08-11T20:00:00.000Z");

    await expect(catalog.getActiveJob(jobId, activeAt)).resolves.toBeNull();
    expect(parameters).toEqual([
      [jobId, jobId],
      [jobId, jobId, activeAt.toISOString()],
    ]);
  });

  it("normalizes a raw PostgreSQL matchable eligibility timestamp", async () => {
    let queryCount = 0;
    const transaction = (() => {
      queryCount += 1;
      return Promise.resolve(
        queryCount === 1
          ? [{ revision: "17" }]
          : [
              {
                id: "00000000-0000-7000-8000-000000000000",
                eligibleThrough: "2026-09-10T20:00:00.000Z",
                title: "Software Engineer",
                locations: ["Remote - US"],
                workMode: null,
                employmentType: null,
              },
            ],
      );
    }) as unknown as postgres.TransactionSql;
    const client = {
      begin: async (_options: string, callback: (sql: postgres.TransactionSql) => unknown) =>
        callback(transaction),
    } as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client, catalogOptions);

    await expect(
      catalog.getMatchableJob(
        "00000000-0000-7000-8000-000000000000",
        new Date("2026-08-11T20:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      job: { eligibleThrough: "2026-09-10T20:00:00.000Z" },
    });
  });

  it("rejects an invalid internal freshness boundary before opening a query", async () => {
    let queryCount = 0;
    const client = (() => {
      queryCount += 1;
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client, catalogOptions);

    await expect(
      catalog.getActiveJob("00000000-0000-7000-8000-000000000000", new Date(Number.NaN)),
    ).rejects.toThrow(RangeError);
    expect(queryCount).toBe(0);
  });

  it("creates an opaque stable cursor and rejects reuse with different filters", async () => {
    const row = {
      id: "00000000-0000-7000-8000-000000000001",
      companyId: "00000000-0000-7000-8000-000000000002",
      companyName: "Synthetic Company",
      companyVerifiedDomain: "example.test",
      title: "Software Engineer",
      locations: ["Remote - US"],
      department: "Engineering",
      firstObservedAt: new Date("2026-08-10T20:00:00.000Z"),
      lastVerifiedAt: new Date("2026-08-11T20:00:00.000Z"),
      expiresAt: new Date("2026-09-10T20:00:00.000Z"),
      rankKey: "1.000000",
    };
    let searchCount = 0;
    const transaction = (() => {
      searchCount += 1;
      return Promise.resolve(
        searchCount % 2 === 1
          ? [{ revision: "7" }]
          : [row, { ...row, id: "00000000-0000-7000-8000-000000000003" }],
      );
    }) as unknown as postgres.TransactionSql;
    const client = {
      begin: async (_options: string, callback: (sql: postgres.TransactionSql) => unknown) =>
        callback(transaction),
    } as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client, catalogOptions);
    const request = { query: "Software Engineer", sort: "relevance" as const, pageSize: 1 };

    const first = await catalog.searchActiveJobs(request, new Date("2026-08-12T20:00:00.000Z"));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [body] = (first.nextCursor as string).split(".");
    const decoded = JSON.parse(Buffer.from(body ?? "", "base64url").toString("utf8"));
    expect(decoded).not.toHaveProperty("query");
    expect(decoded).not.toHaveProperty("requestHash");
    await expect(
      catalog.searchActiveJobs(
        { ...request, query: "Different", cursor: first.nextCursor as string },
        new Date("2026-08-12T20:00:00.000Z"),
      ),
    ).rejects.toThrow("cursor is invalid");
    await expect(
      catalog.searchActiveJobs(
        { ...request, pageSize: 2, cursor: first.nextCursor as string },
        new Date("2026-08-12T20:00:00.000Z"),
      ),
    ).rejects.toThrow("cursor is invalid");
    await expect(
      catalog.searchActiveJobs(
        { ...request, cursor: first.nextCursor as string },
        new Date("2026-08-12T20:16:00.001Z"),
      ),
    ).rejects.toThrow("cursor does not match");
    const [cursorBody, cursorSignature] = (first.nextCursor as string).split(".");
    const tamperedBody = `${cursorBody?.slice(0, -1)}${cursorBody?.endsWith("A") ? "B" : "A"}`;
    await expect(
      catalog.searchActiveJobs(
        { ...request, cursor: `${tamperedBody}.${cursorSignature}` },
        new Date("2026-08-12T20:00:00.000Z"),
      ),
    ).rejects.toThrow("cursor is invalid");
    const unknownVersion = Buffer.from(JSON.stringify({ ...decoded, version: 2 }), "utf8").toString(
      "base64url",
    );
    const canonicalRequest = JSON.stringify({
      query: "software engineer",
      title: null,
      company: null,
      location: null,
      verifiedWithinDays: null,
      sort: "relevance",
      pageSize: 1,
    });
    const unknownVersionSignature = createHmac("sha256", catalogOptions.searchCursorKeys.active.key)
      .update("job-search-cursor:v1\0", "utf8")
      .update(unknownVersion, "ascii")
      .update("\0", "utf8")
      .update(canonicalRequest, "utf8")
      .digest("base64url");
    await expect(
      catalog.searchActiveJobs(
        { ...request, cursor: `${unknownVersion}.${unknownVersionSignature}` },
        new Date("2026-08-12T20:00:00.000Z"),
      ),
    ).rejects.toThrow("cursor version is unsupported");
    expect(searchCount).toBe(2);
  });

  it("normalizes raw PostgreSQL timestamp strings before returning items and creating a cursor", async () => {
    const row = {
      id: "00000000-0000-7000-8000-000000000001",
      companyId: "00000000-0000-7000-8000-000000000002",
      companyName: "Synthetic Company",
      companyVerifiedDomain: "example.test",
      title: "Software Engineer",
      locations: ["Remote - US"],
      department: "Engineering",
      firstObservedAt: "2026-08-10T20:00:00.000Z",
      lastVerifiedAt: "2026-08-11T20:00:00.000Z",
      expiresAt: "2026-09-10T20:00:00.000Z",
      rankKey: "0.000000",
    };
    let queryCount = 0;
    const transaction = (() => {
      queryCount += 1;
      return Promise.resolve(
        queryCount === 1
          ? [{ revision: "7" }]
          : [row, { ...row, id: "00000000-0000-7000-8000-000000000003" }],
      );
    }) as unknown as postgres.TransactionSql;
    const client = {
      begin: async (_options: string, callback: (sql: postgres.TransactionSql) => unknown) =>
        callback(transaction),
    } as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client, catalogOptions);

    const page = await catalog.searchActiveJobs(
      { pageSize: 1 },
      new Date("2026-08-12T20:00:00.000Z"),
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      firstObservedAt: new Date(row.firstObservedAt),
      lastVerifiedAt: new Date(row.lastVerifiedAt),
      expiresAt: new Date(row.expiresAt),
    });
    expect(page.items[0]?.firstObservedAt).toBeInstanceOf(Date);
    expect(page.items[0]?.lastVerifiedAt).toBeInstanceOf(Date);
    expect(page.items[0]?.expiresAt).toBeInstanceOf(Date);
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [body] = (page.nextCursor as string).split(".");
    expect(JSON.parse(Buffer.from(body ?? "", "base64url").toString("utf8"))).toMatchObject({
      lastVerifiedAt: row.lastVerifiedAt,
      id: row.id,
      rankKey: row.rankKey,
    });
  });

  it.each([
    ["invalid string", "not-a-timestamp"],
    ["null", null],
    ["object", { timestamp: "2026-08-11T20:00:00.000Z" }],
  ])("rejects an %s raw PostgreSQL search timestamp", async (_label, invalidTimestamp) => {
    const validRow = {
      id: "00000000-0000-7000-8000-000000000001",
      companyId: "00000000-0000-7000-8000-000000000002",
      companyName: "Synthetic Company",
      companyVerifiedDomain: null,
      title: "Software Engineer",
      locations: ["Remote - US"],
      department: null,
      firstObservedAt: "2026-08-10T20:00:00.000Z",
      lastVerifiedAt: "2026-08-11T20:00:00.000Z",
      expiresAt: "2026-09-10T20:00:00.000Z",
      rankKey: "0.000000",
    };

    for (const field of ["firstObservedAt", "lastVerifiedAt", "expiresAt"] as const) {
      let queryCount = 0;
      const transaction = (() => {
        queryCount += 1;
        return Promise.resolve(
          queryCount === 1 ? [{ revision: "7" }] : [{ ...validRow, [field]: invalidTimestamp }],
        );
      }) as unknown as postgres.TransactionSql;
      const client = {
        begin: async (_options: string, callback: (sql: postgres.TransactionSql) => unknown) =>
          callback(transaction),
      } as unknown as postgres.Sql;
      const catalog = new PostgresJobCatalog(client, catalogOptions);

      await expect(catalog.searchActiveJobs({ pageSize: 1 })).rejects.toThrow("job-search");
    }
  });

  it("rejects invalid search bounds before opening a query", async () => {
    let queryCount = 0;
    const client = {
      begin: async () => {
        queryCount += 1;
        return [];
      },
    } as unknown as postgres.Sql;
    const catalog = new PostgresJobCatalog(client, catalogOptions);

    await expect(catalog.searchActiveJobs({ pageSize: 26 })).rejects.toThrow("page size");
    await expect(catalog.searchActiveJobs({ filters: { verifiedWithinDays: 0 } })).rejects.toThrow(
      "freshness",
    );
    await expect(catalog.searchActiveJobs({ cursor: "not+base64" })).rejects.toThrow("cursor");
    await expect(catalog.searchActiveJobs({ cursor: `${"a".repeat(1024)}.b` })).rejects.toThrow(
      "cursor",
    );
    await expect(catalog.searchActiveJobs({}, new Date(Number.NaN))).rejects.toThrow(
      "freshness boundary",
    );
    expect(queryCount).toBe(0);
  });
});
