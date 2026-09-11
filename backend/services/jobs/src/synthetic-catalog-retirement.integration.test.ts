import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeObservation } from "./domain/canonical-job.js";
import { type CatalogObservation, PostgresJobCatalog } from "./persistence/catalog.js";
import {
  executeSyntheticCatalogRetirement,
  syntheticCatalogRetirementReason,
} from "./synthetic-catalog-retirement.js";

const uuidFault = vi.hoisted(() => ({ next: undefined as string | undefined }));
vi.mock("uuid", async (importOriginal) => {
  const original = await importOriginal<typeof import("uuid")>();
  return {
    ...original,
    v7: () => {
      const next = uuidFault.next;
      uuidFault.next = undefined;
      return next ?? original.v7();
    },
  };
});

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    !/^\/[A-Za-z0-9_-]{1,63}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  ) {
    throw new Error("SyntheticRetirementIntegrationTargetRejected");
  }
}
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL synthetic-only catalog retirement", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 3,
    onnotice: () => undefined,
    connection: { application_name: "synthetic-catalog-retirement-integration" },
  });
  const writer = postgres(databaseUrl ?? "postgres://invalid", {
    max: 1,
    onnotice: () => undefined,
  });
  const catalog = new PostgresJobCatalog(client, {
    acceptedProvenance: new Set(["authorized_fixture", "permitted_api"]),
    searchCursorKeys: { active: { id: "retirement-test-v1", key: Buffer.alloc(32, 5) } },
  });
  let ids: string[] = [];
  let companyIds: string[] = [];
  let savedIds: string[] = [];
  let seed = "";
  const observedAt = new Date(Date.now() - 60_000);
  type GeneratedObservation = Omit<
    CatalogObservation,
    "provider" | "provenance" | "observedAt" | "adapterVersion" | "rawSnapshot"
  >;
  let buildGeneratedSyntheticObservations: (
    seed: string,
    at: Date,
  ) => readonly GeneratedObservation[] = () => {
    throw new Error("Generated fixture module not loaded");
  };

  function fixture(reliability = false): CatalogObservation {
    const generated = buildGeneratedSyntheticObservations(seed, observedAt)[reliability ? 1 : 0];
    if (!generated) throw new Error("Missing actual generated fixture");
    return {
      ...generated,
      provider: "other",
      provenance: "authorized_fixture",
      adapterVersion: "synthetic-ingestion-v1",
      observedAt,
      rawSnapshot: { kind: "generated-synthetic-only", privateSentinel: `preserved-${seed}` },
    };
  }

  async function create(input: CatalogObservation): Promise<string> {
    const result = await catalog.recordObservation(input);
    ids.push(result.job.id);
    companyIds.push(result.job.companyId);
    return result.job.id;
  }

  async function snapshot() {
    return client<{ job: Record<string, unknown>; sources: unknown; events: unknown }[]>`
      SELECT to_jsonb(job) AS job,
        (SELECT jsonb_agg(to_jsonb(source) ORDER BY source.id) FROM jobs.job_sources AS source WHERE source.job_id = job.id) AS sources,
        (SELECT jsonb_agg(to_jsonb(event) ORDER BY event.id) FROM jobs.status_events AS event WHERE event.job_id = job.id) AS events
      FROM jobs.canonical_jobs AS job WHERE id = ANY(${client.array(ids)}::uuid[]) ORDER BY id
    `;
  }

  beforeAll(async () => {
    // Test-only built-worker import: validate the real generator's complete rows,
    // without adding a Jobs production dependency back onto its ingestion consumer.
    const generator = (await import(
      new URL("../../../workers/ingestion/dist/src/synthetic.js", import.meta.url).href
    )) as {
      generatedSyntheticSourceId: string;
      generatedSyntheticAdapterVersion: string;
      buildGeneratedSyntheticObservations: typeof buildGeneratedSyntheticObservations;
    };
    expect(generator.generatedSyntheticSourceId).toBe("synthetic-foundation-v1");
    expect(generator.generatedSyntheticAdapterVersion).toBe("synthetic-ingestion-v1");
    buildGeneratedSyntheticObservations = generator.buildGeneratedSyntheticObservations;
    // Existing Jobs global setup migrates Profile + Jobs; real saved-job persistence
    // additionally uses the existing Matching owner migration, never a fake table.
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("../../matching/dist/src/migrate.js", import.meta.url))],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) =>
              /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
            ),
          ),
          NODE_ENV: "test",
          DATABASE_URL: databaseUrl,
        },
        timeout: 60_000,
        windowsHide: true,
      },
    );
    expect(
      (await executeSyntheticCatalogRetirement(client, { action: "inspect" })).matchingJobs,
    ).toBe(0);
  });

  beforeEach(async () => {
    seed = randomUUID().replaceAll("-", "");
    await create(fixture());
    await create(fixture(true));
    await create({
      ...fixture(),
      provider: "greenhouse",
      provenance: "permitted_api",
      companyName: `Independent Real-source Fixture ${seed}`,
      verifiedCompanyDomain: `${seed}.real.example.test`,
      title: "Independent contributed job fixture",
      department: "Independent Engineering",
      description: "Independent permitted-provider observation must remain active and unchanged.",
      sourceUrl: `https://boards.example.test/${seed}/real`,
      atsTenant: `real-${seed}`,
      externalJobId: `real-${seed}`,
      employerRequisitionId: `real-${seed}`,
      adapterVersion: "greenhouse-board-v1",
    });
  });

  afterEach(async () => {
    uuidFault.next = undefined;
    // Only IDs minted by this test are removed from this explicitly loopback fixture DB.
    if (savedIds.length > 0)
      await client`DELETE FROM matching.saved_jobs WHERE id = ANY(${client.array(savedIds)}::uuid[])`;
    if (ids.length > 0)
      await client`DELETE FROM jobs.canonical_jobs WHERE id = ANY(${client.array(ids)}::uuid[])`;
    if (companyIds.length > 0)
      await client`DELETE FROM jobs.companies WHERE id = ANY(${client.array([...new Set(companyIds)])}::uuid[])`;
    ids = [];
    companyIds = [];
    savedIds = [];
  });

  afterAll(async () => {
    await client.end({ timeout: 1 });
    await writer.end({ timeout: 1 });
  });

  it("hides only generated jobs, preserves payloads/history/saved rows and advances the normal revision once", async () => {
    const generatedId = ids[0];
    if (!generatedId) throw new Error("Missing generated fixture");
    const savedId = randomUUID();
    savedIds.push(savedId);
    await client`
      INSERT INTO matching.saved_jobs (id, owner_user_id, requested_job_id, resolved_canonical_job_id_at_save,
        snapshot_company_id, snapshot_company_name, snapshot_verified_domain, snapshot_title, snapshot_locations,
        snapshot_department, snapshot_first_observed_at, snapshot_last_verified_at, snapshot_expires_at, saved_at, updated_at)
      SELECT ${savedId}, ${randomUUID()}, job.id, job.id, company.id, company.display_name, company.verified_domain,
        job.title, job.normalized_locations, job.department, job.first_observed_at, job.last_verified_at,
        job.expires_at, statement_timestamp(), statement_timestamp()
      FROM jobs.canonical_jobs AS job JOIN jobs.companies AS company ON company.id = job.company_id WHERE job.id = ${generatedId}
    `;
    const savedBefore =
      await client`SELECT to_jsonb(saved) AS value FROM matching.saved_jobs AS saved WHERE id = ${savedId}`;
    const before = await snapshot();
    const revisionBefore = BigInt(await catalog.getCatalogRevision());
    const inspected = await executeSyntheticCatalogRetirement(client, { action: "inspect" });
    expect(inspected).toMatchObject({
      matchingJobs: 2,
      matchingSources: 2,
      retirableJobs: 2,
      retiredJobs: 0,
    });
    expect(await snapshot()).toEqual(before);
    const result = await executeSyntheticCatalogRetirement(client, {
      action: "retire",
      expectedManifestSha256: inspected.manifestSha256,
    });
    expect(result).toMatchObject({
      manifestSha256: inspected.manifestSha256,
      retiredJobs: 2,
      appendedStatusEvents: 2,
    });
    expect(BigInt(await catalog.getCatalogRevision())).toBe(revisionBefore + 1n);
    const after = await snapshot();
    for (let index = 0; index < before.length; index += 1) {
      const prior = before[index];
      const current = after[index];
      if (!prior || !current) throw new Error("Missing generated snapshot");
      if (prior.job.id === ids[2]) {
        expect(current).toEqual(prior);
        expect(await catalog.getActiveJob(String(prior.job.id))).not.toBeNull();
      } else {
        expect(current.job).toMatchObject({
          status: "blocked",
          status_reason: syntheticCatalogRetirementReason,
        });
        expect({
          ...current.job,
          status: prior.job.status,
          status_reason: prior.job.status_reason,
          updated_at: prior.job.updated_at,
        }).toEqual(prior.job);
        expect(current.sources).toEqual(prior.sources);
        expect(current.events).toEqual(expect.arrayContaining(prior.events as unknown[]));
        expect(current.events).toHaveLength((prior.events as unknown[]).length + 1);
        expect(await catalog.getActiveJob(String(prior.job.id))).toBeNull();
        expect(await catalog.getMatchableJob(String(prior.job.id))).toBeNull();
      }
    }
    expect((await catalog.searchActiveJobs({ query: "Generated" })).items).toHaveLength(0);
    expect(
      await client`SELECT to_jsonb(saved) AS value FROM matching.saved_jobs AS saved WHERE id = ${savedId}`,
    ).toEqual(savedBefore);
    await expect(
      executeSyntheticCatalogRetirement(client, {
        action: "retire",
        expectedManifestSha256: inspected.manifestSha256,
      }),
    ).rejects.toThrow("SyntheticCatalogRetirementRejected");
    const second = await executeSyntheticCatalogRetirement(client, { action: "inspect" });
    expect(second).toMatchObject({ retirableJobs: 0, alreadyHiddenJobs: 2 });
    expect(
      await executeSyntheticCatalogRetirement(client, {
        action: "retire",
        expectedManifestSha256: second.manifestSha256,
      }),
    ).toMatchObject({ retiredJobs: 0, appendedStatusEvents: 0 });
    expect(await snapshot()).toEqual(after);
    expect(BigInt(await catalog.getCatalogRevision())).toBe(revisionBefore + 1n);
  });

  it("refuses a stale manifest after a payload-only change without writing status/history", async () => {
    const inspection = await executeSyntheticCatalogRetirement(client, { action: "inspect" });
    await client`UPDATE jobs.job_sources SET raw_snapshot = '{"changed":true}'::jsonb WHERE job_id = ${String(ids[0])}`;
    const before = await snapshot();
    await expect(
      executeSyntheticCatalogRetirement(client, {
        action: "retire",
        expectedManifestSha256: inspection.manifestSha256,
      }),
    ).rejects.toThrow("SyntheticCatalogRetirementRejected");
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a mixed real source and an alias binding before mutation", async () => {
    const firstId = String(ids[0]);
    const secondId = String(ids[2]);
    const sourceUrl = `https://boards.example.test/${seed}/mixed`;
    const hash = canonicalizeObservation({ ...fixture(), sourceUrl }).canonicalUrlHash;
    await client`
      INSERT INTO jobs.job_sources SELECT (jsonb_populate_record(NULL::jobs.job_sources,
        to_jsonb(source) || jsonb_build_object('id', ${randomUUID()}::text, 'provider', 'greenhouse',
          'provenance', 'permitted_api', 'ats_tenant', ${`mixed-${seed}`}::text,
          'external_job_id', 'mixed-real', 'employer_requisition_id', ${`mixed-${seed}`}::text,
          'canonical_url', ${sourceUrl}::text, 'source_url', ${sourceUrl}::text,
          'canonical_url_hash', ${hash}::text, 'adapter_version', 'greenhouse-board-v1'))).*
      FROM jobs.job_sources AS source WHERE source.job_id = ${firstId}
    `;
    const before = await snapshot();
    await expect(executeSyntheticCatalogRetirement(client, { action: "inspect" })).rejects.toThrow(
      "SyntheticCatalogRetirementRejected",
    );
    expect(await snapshot()).toEqual(before);
    await client`DELETE FROM jobs.job_sources WHERE job_id = ${firstId} AND canonical_url = ${sourceUrl}`;
    const ordered = [firstId, secondId].sort();
    await client`
      INSERT INTO jobs.duplicate_candidates (job_id, candidate_job_id, classification, fingerprint, created_at)
      VALUES (${String(ordered[0])}, ${String(ordered[1])}, 'probable', ${"a".repeat(64)}, statement_timestamp())
    `;
    await expect(executeSyntheticCatalogRetirement(client, { action: "inspect" })).rejects.toThrow(
      "SyntheticCatalogRetirementRejected",
    );
    expect(await catalog.getActiveJob(firstId)).not.toBeNull();
  });

  it("rolls back the complete retirement if a status-event insert fails", async () => {
    const inspection = await executeSyntheticCatalogRetirement(client, { action: "inspect" });
    const [event] = await client<
      { id: string }[]
    >`SELECT id FROM jobs.status_events WHERE job_id = ${String(ids[0])} LIMIT 1`;
    if (!event) throw new Error("Missing generated status fixture");
    const before = await snapshot();
    const revision = await catalog.getCatalogRevision();
    uuidFault.next = event.id;
    await expect(
      executeSyntheticCatalogRetirement(client, {
        action: "retire",
        expectedManifestSha256: inspection.manifestSha256,
      }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect(await catalog.getCatalogRevision()).toBe(revision);
  });

  it("refuses a concurrent committed change encountered at the real row lock", async () => {
    const inspection = await executeSyntheticCatalogRetirement(client, { action: "inspect" });
    let acquired: () => void = () => undefined;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writerResult = writer.begin(async (transaction) => {
      await transaction`SELECT id FROM jobs.canonical_jobs WHERE id = ${String(ids[0])} FOR UPDATE`;
      acquired();
      await released;
      await transaction`UPDATE jobs.canonical_jobs SET status_reason = 'generated_concurrent_fixture' WHERE id = ${String(ids[0])}`;
    });
    await held;
    const result = executeSyntheticCatalogRetirement(client, {
      action: "retire",
      expectedManifestSha256: inspection.manifestSha256,
    }).then(
      () => "unexpected-success",
      () => "refused",
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const [activity] = await client<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE application_name = 'synthetic-catalog-retirement-integration'
              AND wait_event_type = 'Lock') AS waiting
        `;
        if (activity?.waiting) {
          waiting = true;
          break;
        }
        await delay(25);
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await writerResult;
    }
    expect(await result).toBe("refused");
    for (const id of ids) expect(await catalog.getActiveJob(id)).not.toBeNull();
    const [events] = await client<
      { count: string }[]
    >`SELECT count(*)::text AS count FROM jobs.status_events WHERE job_id = ANY(${client.array(ids)}::uuid[]) AND reason = ${syntheticCatalogRetirementReason}`;
    expect(events?.count).toBe("0");
  });

  it("counts but never targets other active authorized fixture namespaces", async () => {
    const outsideBefore = (await executeSyntheticCatalogRetirement(client, { action: "inspect" }))
      .otherActiveAuthorizedFixtureJobs;
    const otherId = await create({
      ...fixture(),
      companyName: `Other Authorized Fixture ${seed}`,
      verifiedCompanyDomain: `${seed}.other.example.test`,
      title: "Other authorized search fixture",
      sourceUrl: `https://jobs.example.test/d1-search-acceptance/${randomUUID()}/alpha`,
      atsTenant: `other-${seed}`,
      externalJobId: "other",
      employerRequisitionId: `other-${seed}`,
      adapterVersion: "d1-search-acceptance-v1",
      description: "An independently scoped authorized fixture.",
    });
    const inspected = await executeSyntheticCatalogRetirement(client, { action: "inspect" });
    expect(inspected).toMatchObject({
      matchingJobs: 2,
      otherActiveAuthorizedFixtureJobs: outsideBefore + 1,
    });
    await executeSyntheticCatalogRetirement(client, {
      action: "retire",
      expectedManifestSha256: inspected.manifestSha256,
    });
    expect(await catalog.getActiveJob(otherId)).not.toBeNull();
    expect(
      (await executeSyntheticCatalogRetirement(client, { action: "inspect" }))
        .otherActiveAuthorizedFixtureJobs,
    ).toBe(outsideBefore + 1);
  });
});
