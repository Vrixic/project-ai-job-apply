import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogObservation } from "./catalog.js";
import { createJobCatalogDatabase, PostgresJobCatalog } from "./catalog.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresJobCatalog", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  const catalog = new PostgresJobCatalog(client);
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
      "Jobs migrations through 0003_duplicate_resolution_audit_guard applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Jobs migrations through 0003_duplicate_resolution_audit_guard applied and verified.",
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
