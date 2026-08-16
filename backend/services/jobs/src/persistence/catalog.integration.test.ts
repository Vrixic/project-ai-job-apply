import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildJobSearchAcceptanceFixture,
  executeJobSearchAcceptance,
} from "../search-acceptance.js";
import type { CatalogObservation } from "./catalog.js";
import { createJobCatalogDatabase, PostgresJobCatalog } from "./catalog.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresJobCatalog", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  const catalog = new PostgresJobCatalog(client, {
    searchCursorKeys: { active: { id: "test-v1", key: Buffer.alloc(32, 1) } },
  });
  const runId = crypto.randomUUID();
  const observedAt = new Date("2026-08-11T12:00:00.000Z");

  function fixture(overrides: Partial<CatalogObservation> = {}): CatalogObservation {
    return {
      provider: "greenhouse",
      provenance: "authorized_fixture",
      companyName: `Synthetic Company ${runId}`,
      title: "Software Engineer",
      locations: ["Remote - US"],
      description: "A synthetic catalog record used only for integration verification.",
      sourceUrl: `https://jobs.example.test/${runId}/1?utm_source=fixture`,
      observedAt,
      atsTenant: `tenant-${runId}`,
      externalJobId: "job-1",
      employerRequisitionId: `req-${runId}-1`,
      verifiedCompanyDomain: `${runId}.example.test`,
      adapterVersion: "synthetic-v1",
      rawSnapshot: { fixture: true },
      ...overrides,
    };
  }

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(
      new URL("../../dist/src/migrate.js", import.meta.url),
    );
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    expect(first.stdout.trim()).toBe(
      "Jobs migrations through 0004_job_search applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Jobs migrations through 0004_job_search applied and verified.",
    );
    await catalog.ping();
  });

  afterAll(async () => {
    await catalog.close();
  });

  it("merges only exact identities and retains source provenance", async () => {
    const created = await catalog.recordObservation(fixture());
    const replay = await catalog.recordObservation(
      fixture({ description: "The verified source supplied an updated synthetic description." }),
    );

    expect(created.outcome).toBe("created");
    expect(replay.outcome).toBe("exact_match_updated");
    expect(replay.job.id).toBe(created.job.id);
    expect(replay.job.description).toContain("updated synthetic description");
    const [source] = await client<
      Array<{ provenance: string; adapterVersion: string; rawSnapshot: Record<string, unknown> }>
    >`
      SELECT provenance, adapter_version AS "adapterVersion", raw_snapshot AS "rawSnapshot"
      FROM jobs.job_sources WHERE job_id = ${created.job.id}
    `;
    expect(source).toEqual({
      provenance: "authorized_fixture",
      adapterVersion: "synthetic-v1",
      rawSnapshot: { fixture: true },
    });
  });

  it("persists SQL NULL when an observation omits its raw snapshot", async () => {
    const withoutRawSnapshot = fixture({
      sourceUrl: `https://jobs.example.test/${runId}/without-raw-snapshot`,
      externalJobId: "without-raw-snapshot",
      employerRequisitionId: `req-${runId}-without-raw-snapshot`,
    });
    delete withoutRawSnapshot.rawSnapshot;

    const created = await catalog.recordObservation(withoutRawSnapshot);
    const replayed = await catalog.recordObservation({
      ...withoutRawSnapshot,
      description: "The same synthetic observation remains snapshot-free after revalidation.",
    });
    const [source] = await client<{ rawSnapshotIsNull: boolean }[]>`
      SELECT raw_snapshot IS NULL AS "rawSnapshotIsNull"
      FROM jobs.job_sources
      WHERE job_id = ${created.job.id}
    `;

    expect(created.outcome).toBe("created");
    expect(replayed.outcome).toBe("exact_match_updated");
    expect(source?.rawSnapshotIsNull).toBe(true);
  });

  it("returns only the active redacted read model", async () => {
    const created = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/active-read`,
        externalJobId: "active-read",
        employerRequisitionId: `req-${runId}-active-read`,
        department: "Engineering",
        validThrough: new Date("2026-09-20T12:00:00.000Z"),
      }),
    );

    const active = await catalog.getActiveJob(created.job.id, observedAt);

    expect(active).toMatchObject({
      id: created.job.id,
      company: {
        name: `Synthetic Company ${runId}`,
        verifiedDomain: `${runId}.example.test`,
      },
      title: "Software Engineer",
      locations: ["Remote - US"],
      department: "Engineering",
      status: "active",
      sources: [
        {
          provider: "greenhouse",
          provenance: "authorized_fixture",
          canonicalUrl: `https://jobs.example.test/${runId}/active-read`,
        },
      ],
    });
    expect(active?.description).toContain("synthetic catalog record");
    expect(active?.sources[0]).not.toHaveProperty("rawSnapshot");
    expect(active?.sources[0]).not.toHaveProperty("externalJobId");
    expect(active?.sources[0]).not.toHaveProperty("atsTenant");
  });

  it("searches and filters active jobs with stable opaque keyset pagination", async () => {
    const searchToken = `résumé-${runId}`;
    const first = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/search-a`,
        externalJobId: "search-a",
        employerRequisitionId: `req-${runId}-search-a`,
        title: "Principal Unicode Engineer",
        locations: ["Montréal, QC"],
        department: "Internationalization",
        description: `${searchToken} builds reliable multilingual systems.`,
      }),
    );
    const second = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/search-b`,
        externalJobId: "search-b",
        employerRequisitionId: `req-${runId}-search-b`,
        title: "Principal Unicode Engineer",
        locations: ["Montréal, QC"],
        department: "Internationalization",
        description: `${searchToken} improves deterministic language tooling.`,
      }),
    );
    await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/search-filtered-out`,
        externalJobId: "search-filtered-out",
        employerRequisitionId: `req-${runId}-search-filtered-out`,
        title: "Product Designer",
        locations: ["Boston, MA"],
        description: "A distinct synthetic design role.",
      }),
    );

    const request = {
      query: searchToken,
      filters: {
        title: "Principal Unicode Engineer",
        company: `Synthetic Company ${runId}`,
        location: "Montréal, QC",
        verifiedWithinDays: 2,
      },
      sort: "relevance" as const,
      pageSize: 1,
    };
    const pageOne = await catalog.searchActiveJobs(request, observedAt);
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(pageOne.items[0]).not.toHaveProperty("description");
    const pageTwo = await catalog.searchActiveJobs(
      { ...request, cursor: pageOne.nextCursor as string },
      observedAt,
    );
    expect(pageTwo.items).toHaveLength(1);
    expect(new Set([...pageOne.items, ...pageTwo.items].map((job) => job.id))).toEqual(
      new Set([first.job.id, second.job.id]),
    );
    expect(pageTwo).not.toHaveProperty("nextCursor");
    const freshnessOne = await catalog.searchActiveJobs(
      { filters: request.filters, sort: "freshness", pageSize: 1 },
      observedAt,
    );
    const freshnessTwo = await catalog.searchActiveJobs(
      {
        filters: request.filters,
        sort: "freshness",
        pageSize: 1,
        cursor: freshnessOne.nextCursor as string,
      },
      observedAt,
    );
    expect(new Set([...freshnessOne.items, ...freshnessTwo.items].map((job) => job.id))).toEqual(
      new Set([first.job.id, second.job.id]),
    );
    await expect(
      catalog.searchActiveJobs(
        { ...request, query: "different", cursor: pageOne.nextCursor as string },
        observedAt,
      ),
    ).rejects.toThrow("Search cursor is invalid");
  });

  it("parameterizes search text and excludes blocked, expired, and exact-alias losers", async () => {
    const token = `aliassearch${runId.replaceAll("-", "")}`;
    const canonical = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/search-alias-a`,
        externalJobId: "search-alias-a",
        employerRequisitionId: `req-${runId}-search-alias-a`,
        description: `${token} shared description`,
      }),
    );
    const alias = await catalog.recordObservation(
      fixture({
        provider: "other",
        sourceUrl: `https://mirror.example.test/${runId}/search-alias-b`,
        atsTenant: `search-alias-${runId}`,
        externalJobId: "search-alias-b",
        employerRequisitionId: `req-${runId}-search-alias-b`,
        description: `${token} shared description`,
      }),
    );
    await catalog.reviewDuplicateCandidate({
      jobId: canonical.job.id,
      candidateJobId: alias.job.id,
      resolution: "exact",
      canonicalJobId: canonical.job.id,
      reviewedBy: "operator:synthetic-test",
      reasonCode: "synthetic.search_alias",
      reviewedAt: observedAt,
    });
    const blocked = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/search-blocked`,
        externalJobId: "search-blocked",
        employerRequisitionId: `req-${runId}-search-blocked`,
        description: `${token} blocked description`,
      }),
    );
    await catalog.setTerminalStatus(
      blocked.job.id,
      "blocked",
      "synthetic_search_block",
      observedAt,
    );
    await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/search-expired`,
        externalJobId: "search-expired",
        employerRequisitionId: `req-${runId}-search-expired`,
        description: `${token} expired description`,
        observedAt: new Date("2026-06-01T12:00:00.000Z"),
      }),
    );

    const active = await catalog.searchActiveJobs({ query: token, pageSize: 25 }, observedAt);
    expect(active.items.map((job) => job.id)).toEqual([canonical.job.id]);
    const afterExpiry = await catalog.searchActiveJobs(
      { query: token, pageSize: 25 },
      new Date(canonical.job.expiresAt.getTime() + 1),
    );
    expect(afterExpiry.items).toEqual([]);

    const injection = await catalog.searchActiveJobs(
      { query: "' OR true; DROP TABLE jobs.canonical_jobs; --", pageSize: 25 },
      observedAt,
    );
    expect(injection.items).toEqual([]);
    const [catalogStillPresent] = await client<{ present: boolean }[]>`
      SELECT to_regclass('jobs.canonical_jobs') IS NOT NULL AS present
    `;
    expect(catalogStillPresent?.present).toBe(true);
  });

  it("fails a continuation explicitly when a catalog mutation changes the search revision", async () => {
    const token = `mutationsearch${runId.replaceAll("-", "")}`;
    for (const suffix of ["a", "b"]) {
      await catalog.recordObservation(
        fixture({
          sourceUrl: `https://jobs.example.test/${runId}/mutation-${suffix}`,
          externalJobId: `mutation-${suffix}`,
          employerRequisitionId: `req-${runId}-mutation-${suffix}`,
          description: `${token} deterministic pagination record`,
        }),
      );
    }
    const request = { query: token, pageSize: 1, sort: "freshness" as const };
    const first = await catalog.searchActiveJobs(request, observedAt);
    expect(first.nextCursor).toBeDefined();

    await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/mutation-after-first-page`,
        externalJobId: "mutation-after-first-page",
        employerRequisitionId: `req-${runId}-mutation-after-first-page`,
        description: "An unrelated catalog mutation.",
      }),
    );

    await expect(
      catalog.searchActiveJobs({ ...request, cursor: first.nextCursor as string }, observedAt),
    ).rejects.toThrow("catalog changed");
  });

  it("uses the owned synthetic acceptance contract to invalidate and clean a deployed-style cursor", async () => {
    const acceptanceRunId = crypto.randomUUID();
    const preparedAt = new Date();
    const prepared = await executeJobSearchAcceptance(client, {
      action: "prepare",
      runId: acceptanceRunId,
      at: preparedAt,
    });
    const request = { query: prepared.queryToken, pageSize: 1, sort: "freshness" as const };

    try {
      expect(prepared.affectedJobs).toBe(3);
      expect(BigInt(prepared.revisionAfter)).toBeGreaterThan(BigInt(prepared.revisionBefore));
      const first = await catalog.searchActiveJobs(request, preparedAt);
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeDefined();

      const mutated = await executeJobSearchAcceptance(client, {
        action: "mutate",
        runId: acceptanceRunId,
        at: new Date(preparedAt.getTime() + 1_000),
      });
      expect(mutated.affectedJobs).toBe(1);
      expect(BigInt(mutated.revisionAfter)).toBeGreaterThan(BigInt(mutated.revisionBefore));
      await expect(
        catalog.searchActiveJobs({ ...request, cursor: first.nextCursor as string }, preparedAt),
      ).rejects.toThrow("catalog changed");

      const restartedFirst = await catalog.searchActiveJobs(request, preparedAt);
      const restartedSecond = await catalog.searchActiveJobs(
        { ...request, cursor: restartedFirst.nextCursor as string },
        preparedAt,
      );
      const restartedIds = [...restartedFirst.items, ...restartedSecond.items].map((job) => job.id);
      expect(restartedIds).toHaveLength(2);
      expect(new Set(restartedIds).size).toBe(2);
      expect(restartedSecond.nextCursor).toBeUndefined();
    } finally {
      const cleaned = await executeJobSearchAcceptance(client, {
        action: "cleanup",
        runId: acceptanceRunId,
      });
      expect(cleaned.affectedJobs).toBe(3);
      expect(
        await catalog.searchActiveJobs({ query: prepared.queryToken, pageSize: 25 }, new Date()),
      ).toEqual({ items: [] });
    }
  });

  it("refuses cleanup when a claimed acceptance job has an unexpected source", async () => {
    const acceptanceRunId = crypto.randomUUID();
    const preparedAt = new Date();
    const fixtureDefinition = buildJobSearchAcceptanceFixture(acceptanceRunId, preparedAt);
    const fixtureSource = fixtureDefinition.jobs[0];
    if (!fixtureSource) {
      throw new Error("The acceptance fixture definition is incomplete");
    }
    await executeJobSearchAcceptance(client, {
      action: "prepare",
      runId: acceptanceRunId,
      at: preparedAt,
    });
    const unexpectedSourceId = crypto.randomUUID();
    const unexpectedIdentity = crypto.randomUUID().replaceAll("-", "");

    try {
      const inserted = await client`
        INSERT INTO jobs.job_sources (
          id, job_id, provider, provenance, ats_tenant, external_job_id,
          employer_requisition_id, verified_company_domain, source_url, canonical_url,
          canonical_url_hash, content_hash, adapter_version, raw_snapshot, first_observed_at,
          last_observed_at, last_verified_at, valid_through, created_at, updated_at
        )
        SELECT
          ${unexpectedSourceId}, job_id, provider, provenance, ats_tenant,
          ${`unexpected-${acceptanceRunId}`}, ${`unexpected-${acceptanceRunId}`},
          verified_company_domain, ${`https://jobs.example.test/${unexpectedIdentity}`},
          ${`https://jobs.example.test/${unexpectedIdentity}`},
          ${unexpectedIdentity.padEnd(64, "0")}, content_hash, adapter_version, raw_snapshot,
          first_observed_at, last_observed_at, last_verified_at, valid_through, created_at, updated_at
        FROM jobs.job_sources
        WHERE id = ${fixtureSource.sourceId}
      `;
      expect(inserted.count).toBe(1);
      await expect(
        executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId }),
      ).rejects.toThrow("unexpected related records");
      const [remaining] = await client<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM jobs.job_sources AS source
        INNER JOIN jobs.canonical_jobs AS job ON job.id = source.job_id
        WHERE job.company_id = ${fixtureDefinition.companyId}
      `;
      expect(remaining?.count).toBe(4);
    } finally {
      await client`DELETE FROM jobs.job_sources WHERE id = ${unexpectedSourceId}`;
      await executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId });
    }
  });

  it("refuses mutation or cleanup when matching-job phase or lifecycle state is altered", async () => {
    const acceptanceRunId = crypto.randomUUID();
    const preparedAt = new Date();
    const fixtureDefinition = buildJobSearchAcceptanceFixture(acceptanceRunId, preparedAt);
    const matchingSource = fixtureDefinition.jobs.find((job) => job.matchesQuery);
    if (!matchingSource) {
      throw new Error("The acceptance fixture definition has no matching source");
    }
    await executeJobSearchAcceptance(client, {
      action: "prepare",
      runId: acceptanceRunId,
      at: preparedAt,
    });
    const [claimed] = await client<{ jobId: string }[]>`
      SELECT job_id AS "jobId" FROM jobs.job_sources WHERE id = ${matchingSource.sourceId}
    `;
    if (!claimed) {
      throw new Error("The prepared acceptance job is unavailable");
    }

    try {
      await client`
        UPDATE jobs.canonical_jobs
        SET status_reason = 'search_acceptance_revision_bumped'
        WHERE id = ${claimed.jobId}
      `;
      await expect(
        executeJobSearchAcceptance(client, {
          action: "mutate",
          runId: acceptanceRunId,
          at: new Date(preparedAt.getTime() + 1_000),
        }),
      ).rejects.toThrow("exact expected phase");
      await expect(
        executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId }),
      ).rejects.toThrow("exact expected phase");
      await client`
        UPDATE jobs.canonical_jobs
        SET status_reason = 'search_acceptance_seeded', consecutive_verification_failures = 1
        WHERE id = ${claimed.jobId}
      `;
      await expect(
        executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId }),
      ).rejects.toThrow("exact contract");
    } finally {
      await client`
        UPDATE jobs.canonical_jobs
        SET status_reason = 'search_acceptance_seeded', consecutive_verification_failures = 0
        WHERE id = ${claimed.jobId}
      `;
      await executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId });
    }
  });

  it("refuses cleanup when the sentinel mutation timestamp is not the exact reviewed offset", async () => {
    const acceptanceRunId = crypto.randomUUID();
    const preparedAt = new Date();
    const exactMutationAt = new Date(preparedAt.getTime() + 1_000);
    const wrongMutationAt = new Date(preparedAt.getTime() + 2_000);
    const fixtureDefinition = buildJobSearchAcceptanceFixture(acceptanceRunId, preparedAt);
    const sentinelSource = fixtureDefinition.jobs.find((job) => job.slug === "sentinel");
    if (!sentinelSource) {
      throw new Error("The acceptance fixture definition has no sentinel source");
    }
    await executeJobSearchAcceptance(client, {
      action: "prepare",
      runId: acceptanceRunId,
      at: preparedAt,
    });
    const [claimed] = await client<{ jobId: string }[]>`
      SELECT job_id AS "jobId" FROM jobs.job_sources WHERE id = ${sentinelSource.sourceId}
    `;
    if (!claimed) {
      throw new Error("The prepared acceptance sentinel is unavailable");
    }

    try {
      await client`
        UPDATE jobs.canonical_jobs
        SET status_reason = 'search_acceptance_revision_bumped',
          last_verified_at = ${wrongMutationAt}, updated_at = ${wrongMutationAt}
        WHERE id = ${claimed.jobId}
      `;
      await client`
        UPDATE jobs.job_sources
        SET last_observed_at = ${wrongMutationAt}, last_verified_at = ${wrongMutationAt},
          updated_at = ${wrongMutationAt}
        WHERE id = ${sentinelSource.sourceId}
      `;
      await expect(
        executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId }),
      ).rejects.toThrow("invalid mutation timestamp");
    } finally {
      await client`
        UPDATE jobs.canonical_jobs
        SET status_reason = 'search_acceptance_revision_bumped',
          last_verified_at = ${exactMutationAt}, updated_at = ${exactMutationAt}
        WHERE id = ${claimed.jobId}
      `;
      await client`
        UPDATE jobs.job_sources
        SET last_observed_at = ${exactMutationAt}, last_verified_at = ${exactMutationAt},
          updated_at = ${exactMutationAt}
        WHERE id = ${sentinelSource.sourceId}
      `;
      await executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId });
    }
  });

  it("refuses cleanup when exact source timestamps or status-event evidence are altered", async () => {
    const acceptanceRunId = crypto.randomUUID();
    const preparedAt = new Date();
    const fixtureDefinition = buildJobSearchAcceptanceFixture(acceptanceRunId, preparedAt);
    const fixtureSource = fixtureDefinition.jobs[0];
    if (!fixtureSource) {
      throw new Error("The acceptance fixture definition is incomplete");
    }
    await executeJobSearchAcceptance(client, {
      action: "prepare",
      runId: acceptanceRunId,
      at: preparedAt,
    });
    const [claimed] = await client<{ jobId: string }[]>`
      SELECT job_id AS "jobId" FROM jobs.job_sources WHERE id = ${fixtureSource.sourceId}
    `;
    if (!claimed) {
      throw new Error("The prepared acceptance job is unavailable");
    }

    try {
      await client`
        UPDATE jobs.job_sources
        SET last_verified_at = last_verified_at + interval '1 second'
        WHERE id = ${fixtureSource.sourceId}
      `;
      await expect(
        executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId }),
      ).rejects.toThrow("exact contract");
      await client`
        UPDATE jobs.job_sources SET last_verified_at = ${preparedAt}
        WHERE id = ${fixtureSource.sourceId}
      `;
      await client`
        UPDATE jobs.status_events SET reason = 'tampered_acceptance_event'
        WHERE job_id = ${claimed.jobId}
      `;
      await expect(
        executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId }),
      ).rejects.toThrow("unexpected status event");
    } finally {
      await client`
        UPDATE jobs.job_sources SET last_verified_at = ${preparedAt}
        WHERE id = ${fixtureSource.sourceId}
      `;
      await client`
        UPDATE jobs.status_events SET reason = 'search_acceptance_seeded'
        WHERE job_id = ${claimed.jobId}
      `;
      await executeJobSearchAcceptance(client, { action: "cleanup", runId: acceptanceRunId });
    }
  });

  it("uses the normalized-location GIN index for a representative containment filter", async () => {
    const fixtureCompanyId = "20000000-0000-7000-8000-000000000001";
    const rollback = new Error("rollback representative search-plan fixture");
    let serializedPlan = "";

    await expect(
      client.begin(async (transaction) => {
        await transaction`
          INSERT INTO jobs.companies (
            id, display_name, normalized_name, verified_domain
          ) VALUES (
            ${fixtureCompanyId},
            ${"Representative Planner Fixture"},
            ${"representative planner fixture"},
            ${"planner-fixture.example.test"}
          )
        `;
        await transaction`
          INSERT INTO jobs.canonical_jobs (
            id,
            company_id,
            title,
            normalized_title,
            locations,
            normalized_locations,
            description,
            dedupe_fingerprint,
            status,
            first_observed_at,
            last_verified_at,
            expires_at
          )
          SELECT
            (
              '20000000-0000-7000-8000-' || lpad(series::text, 12, '0')
            )::uuid,
            ${fixtureCompanyId}::uuid,
            'Synthetic planner job ' || series,
            'synthetic planner job ' || series,
            CASE
              WHEN series = 4242 THEN '["Selective Planner Location"]'::jsonb
              ELSE '["Representative Other Location"]'::jsonb
            END,
            CASE
              WHEN series = 4242 THEN ARRAY['selective planner location']::text[]
              ELSE ARRAY['representative other location']::text[]
            END,
            'Synthetic planner-only fixture',
            'planner-fixture-' || series,
            'active',
            ${observedAt.toISOString()}::timestamptz,
            ${observedAt.toISOString()}::timestamptz,
            ${new Date(observedAt.getTime() + 86_400_000).toISOString()}::timestamptz
          FROM generate_series(1, 10000) AS series
        `;
        await transaction`ANALYZE jobs.canonical_jobs`;
        const [plan] = await transaction<Array<{ "QUERY PLAN": unknown }>>`
          EXPLAIN (FORMAT JSON)
          SELECT id
          FROM jobs.canonical_jobs
          WHERE normalized_locations @> ARRAY[${"selective planner location"}]::text[]
        `;
        serializedPlan = JSON.stringify(plan?.["QUERY PLAN"]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    expect(serializedPlan).toContain('"Node Type":"Bitmap Index Scan"');
    expect(serializedPlan).toContain('"Index Name":"canonical_jobs_normalized_locations_gin"');
    const [rolledBack] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM jobs.companies
      WHERE id = ${fixtureCompanyId}
    `;
    expect(rolledBack?.count).toBe(0);
  });

  it("flags a fuzzy match without merging canonical records", async () => {
    const first = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/probable-a`,
        externalJobId: "probable-a",
        employerRequisitionId: `req-${runId}-probable-a`,
      }),
    );
    const second = await catalog.recordObservation(
      fixture({
        provider: "other",
        sourceUrl: `https://mirror.example.test/${runId}/probable-b`,
        atsTenant: `mirror-${runId}`,
        externalJobId: "probable-b",
        employerRequisitionId: `req-${runId}-probable-b`,
      }),
    );

    expect(second.outcome).toBe("created");
    expect(second.job.id).not.toBe(first.job.id);
    expect(second.probableDuplicateJobIds).toContain(first.job.id);
    const [candidateCount] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM jobs.duplicate_candidates
      WHERE job_id IN (${first.job.id}, ${second.job.id})
        AND candidate_job_id IN (${first.job.id}, ${second.job.id})
        AND classification = 'probable'
    `;
    expect(candidateCount?.count).toBe(1);
  });

  it("resolves probable duplicates reversibly without moving source provenance", async () => {
    const first = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/review-a`,
        externalJobId: "review-a",
        employerRequisitionId: `req-${runId}-review-a`,
      }),
    );
    const second = await catalog.recordObservation(
      fixture({
        provider: "other",
        sourceUrl: `https://mirror.example.test/${runId}/review-b`,
        atsTenant: `review-mirror-${runId}`,
        externalJobId: "review-b",
        employerRequisitionId: `req-${runId}-review-b`,
      }),
    );
    const reviewedAt = new Date("2026-08-11T13:00:00.000Z");
    const exact = await catalog.reviewDuplicateCandidate({
      jobId: second.job.id,
      candidateJobId: first.job.id,
      resolution: "exact",
      canonicalJobId: first.job.id,
      reviewedBy: "operator:synthetic-test",
      reasonCode: "synthetic.same_opening",
      reviewedAt,
    });

    expect(exact).toMatchObject({
      resolution: "exact",
      canonicalJobId: first.job.id,
      reviewedBy: "operator:synthetic-test",
      resolutionVersion: 1,
    });
    expect(await catalog.resolveCanonicalJobId(second.job.id)).toBe(first.job.id);
    const canonicalFromAlias = await catalog.getActiveJob(second.job.id, reviewedAt);
    expect(canonicalFromAlias?.id).toBe(first.job.id);
    expect(canonicalFromAlias?.sources.map((source) => source.provider).sort()).toEqual([
      "greenhouse",
      "other",
    ]);

    const reopened = await catalog.reopenDuplicateCandidate({
      jobId: first.job.id,
      candidateJobId: second.job.id,
      reviewedBy: "operator:synthetic-test",
      reasonCode: "synthetic.unmerge_test",
      reviewedAt: new Date("2026-08-11T14:00:00.000Z"),
    });
    expect(reopened).toMatchObject({ resolutionVersion: 2 });
    expect(reopened).not.toHaveProperty("resolution");
    expect(await catalog.resolveCanonicalJobId(second.job.id)).toBe(second.job.id);
    expect((await catalog.getActiveJob(first.job.id, reviewedAt))?.sources).toHaveLength(1);
    expect((await catalog.getActiveJob(second.job.id, reviewedAt))?.sources).toHaveLength(1);

    const related = await catalog.reviewDuplicateCandidate({
      jobId: first.job.id,
      candidateJobId: second.job.id,
      resolution: "related_repost",
      reviewedBy: "operator:synthetic-test",
      reasonCode: "synthetic.related_repost",
      reviewedAt: new Date("2026-08-11T15:00:00.000Z"),
    });
    expect(related).toMatchObject({ resolution: "related_repost", resolutionVersion: 3 });
    expect(await catalog.resolveCanonicalJobId(second.job.id)).toBe(second.job.id);

    const events = await client<
      Array<{
        previousResolution: string | null;
        resolution: string | null;
        resolutionVersion: number;
      }>
    >`
      SELECT
        previous_resolution AS "previousResolution",
        resolution,
        resolution_version AS "resolutionVersion"
      FROM jobs.duplicate_resolution_events
      WHERE job_id = ${exact.jobId} AND candidate_job_id = ${exact.candidateJobId}
      ORDER BY resolution_version
    `;
    expect(events).toEqual([
      { previousResolution: null, resolution: "exact", resolutionVersion: 1 },
      { previousResolution: "exact", resolution: null, resolutionVersion: 2 },
      { previousResolution: null, resolution: "related_repost", resolutionVersion: 3 },
    ]);
    await expect(
      client`
        UPDATE jobs.duplicate_resolution_events
        SET reason_code = 'synthetic.forbidden_mutation'
        WHERE job_id = ${exact.jobId} AND candidate_job_id = ${exact.candidateJobId}
      `,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      client`
        DELETE FROM jobs.duplicate_resolution_events
        WHERE job_id = ${exact.jobId} AND candidate_job_id = ${exact.candidateJobId}
      `,
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("rejects invalid review metadata and ambiguous exact-merge topology", async () => {
    const first = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/topology-a`,
        externalJobId: "topology-a",
        employerRequisitionId: `req-${runId}-topology-a`,
      }),
    );
    const second = await catalog.recordObservation(
      fixture({
        provider: "other",
        sourceUrl: `https://mirror.example.test/${runId}/topology-b`,
        atsTenant: `topology-b-${runId}`,
        externalJobId: "topology-b",
        employerRequisitionId: `req-${runId}-topology-b`,
      }),
    );
    const third = await catalog.recordObservation(
      fixture({
        provider: "lever",
        sourceUrl: `https://lever.example.test/${runId}/topology-c`,
        atsTenant: `topology-c-${runId}`,
        externalJobId: "topology-c",
        employerRequisitionId: `req-${runId}-topology-c`,
      }),
    );
    const reviewedAt = new Date("2026-08-11T16:00:00.000Z");

    await expect(
      catalog.reviewDuplicateCandidate({
        jobId: first.job.id,
        candidateJobId: second.job.id,
        resolution: "exact",
        canonicalJobId: first.job.id,
        reviewedBy: "reviewer@example.test",
        reasonCode: "synthetic.invalid_reviewer",
        reviewedAt,
      }),
    ).rejects.toThrow("non-PII opaque identifier");

    await catalog.reviewDuplicateCandidate({
      jobId: first.job.id,
      candidateJobId: second.job.id,
      resolution: "exact",
      canonicalJobId: first.job.id,
      reviewedBy: "operator:synthetic-test",
      reasonCode: "synthetic.canonical_edge",
      reviewedAt,
    });
    await expect(
      catalog.reviewDuplicateCandidate({
        jobId: first.job.id,
        candidateJobId: third.job.id,
        resolution: "exact",
        canonicalJobId: third.job.id,
        reviewedBy: "operator:synthetic-test",
        reasonCode: "synthetic.ambiguous_topology",
        reviewedAt,
      }),
    ).rejects.toThrow("ambiguous canonical-job topology");
  });

  it("serializes concurrent exact observations into one canonical job and source", async () => {
    const concurrentFixture = fixture({
      sourceUrl: `https://jobs.example.test/${runId}/concurrent`,
      externalJobId: "concurrent",
      employerRequisitionId: `req-${runId}-concurrent`,
    });
    const [left, right] = await Promise.all([
      catalog.recordObservation(concurrentFixture),
      catalog.recordObservation(concurrentFixture),
    ]);
    expect(left.job.id).toBe(right.job.id);
    expect([left.outcome, right.outcome].sort()).toEqual(["created", "exact_match_updated"]);
    const [counts] = await client<{ jobs: number; sources: number }[]>`
      SELECT
        (SELECT count(*)::int FROM jobs.canonical_jobs WHERE id = ${left.job.id}) AS jobs,
        (SELECT count(*)::int FROM jobs.job_sources WHERE job_id = ${left.job.id}) AS sources
    `;
    expect(counts).toEqual({ jobs: 1, sources: 1 });
  });

  it("fails closed for unapproved real-source provenance", async () => {
    await expect(
      catalog.recordObservation(
        fixture({
          provenance: "permitted_api",
          sourceUrl: `https://jobs.example.test/${runId}/not-authorized`,
        }),
      ),
    ).rejects.toThrow("is not enabled for this runtime");
  });

  it("moves repeated failures through suspect stale and expires to a minimal tombstone", async () => {
    const created = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/expiry`,
        externalJobId: "expiry",
        employerRequisitionId: `req-${runId}-expiry`,
      }),
    );
    expect(await catalog.recordVerificationFailure(created.job.id, observedAt)).toBe("active");
    expect(await catalog.recordVerificationFailure(created.job.id, observedAt)).toBe("active");
    expect(await catalog.recordVerificationFailure(created.job.id, observedAt)).toBe(
      "suspect_stale",
    );

    const afterExpiry = new Date("2026-09-11T12:00:00.000Z");
    expect(await catalog.expireStaleJobs(afterExpiry)).toContain(created.job.id);
    const expired = await catalog.getById(created.job.id);
    expect(expired).toMatchObject({ id: created.job.id, status: "expired" });
    expect(expired).not.toHaveProperty("description");
    expect(await catalog.getActiveJob(created.job.id, afterExpiry)).toBeNull();
    const [source] = await client<{ rawSnapshot: Record<string, unknown> | null }[]>`
      SELECT raw_snapshot AS "rawSnapshot" FROM jobs.job_sources
      WHERE job_id = ${created.job.id}
    `;
    expect(source?.rawSnapshot).toBeNull();
  });

  it("keeps blocked jobs terminal and prevents later observations from restoring raw content", async () => {
    const created = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/blocked`,
        externalJobId: "blocked",
        employerRequisitionId: `req-${runId}-blocked`,
      }),
    );
    await catalog.setTerminalStatus(
      created.job.id,
      "blocked",
      "synthetic_moderation_decision",
      observedAt,
    );
    const replay = await catalog.recordObservation(
      fixture({
        sourceUrl: `https://jobs.example.test/${runId}/blocked`,
        externalJobId: "blocked",
        employerRequisitionId: `req-${runId}-blocked`,
        description: "This content must not revive the blocked record.",
        rawSnapshot: { shouldNotPersist: true },
      }),
    );
    expect(replay.job.status).toBe("blocked");
    expect(replay.job).not.toHaveProperty("description");
    expect(await catalog.getActiveJob(created.job.id, observedAt)).toBeNull();
    const [source] = await client<{ rawSnapshot: Record<string, unknown> | null }[]>`
      SELECT raw_snapshot AS "rawSnapshot" FROM jobs.job_sources
      WHERE job_id = ${created.job.id}
    `;
    expect(source?.rawSnapshot).toBeNull();
  });
});
