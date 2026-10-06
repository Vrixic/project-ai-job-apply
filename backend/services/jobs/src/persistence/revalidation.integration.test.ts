import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SourceFreshnessPolicyRegistry } from "../freshness-policy.js";
import { SourceRevalidationService } from "../revalidation.js";
import { createJobCatalogDatabase } from "./catalog.js";
import { PostgresSourceRevalidationStore } from "./revalidation.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("D2 source-aware revalidation persistence", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 3,
  });
  const store = new PostgresSourceRevalidationStore(client);
  const policy = {
    provider: "lever",
    pageVariant: "lever-posting-v1",
    policyVersion: "synthetic-lever-lifecycle-v1",
    suspectAfterHours: 24,
    expiresAfterHours: 72,
  } as const;
  const service = new SourceRevalidationService(
    store,
    new SourceFreshnessPolicyRegistry([policy]),
    {
      maxAttempts: 3,
      claimLeaseMilliseconds: 1_000,
      retryDelayMilliseconds: [1_000, 2_000],
    },
    { authorize: async () => true },
  );
  const companyId = uuidv7();
  const createdJobIds: string[] = [];
  const migrationExecutable = fileURLToPath(new URL("../../dist/src/migrate.js", import.meta.url));
  const epoch = new Date("2026-09-01T12:00:00.000Z");

  async function seedSource(slug: string) {
    const jobId = uuidv7();
    const sourceId = uuidv7();
    const sourceUrl = `https://jobs.lever.co/synthetic/${slug}`;
    createdJobIds.push(jobId);
    await client`
      INSERT INTO jobs.canonical_jobs (
        id, company_id, title, normalized_title, locations, normalized_locations,
        department, normalized_department, description, description_hash,
        dedupe_fingerprint, status, first_observed_at, last_verified_at, expires_at,
        application_url, structured_locations, valid_through, created_at, updated_at
      ) VALUES (
        ${jobId}, ${companyId}, ${`Synthetic ${slug}`}, ${`synthetic ${slug}`},
        ${client.json(["New York, NY"])}, ${["new york, ny"]}, 'Engineering', 'engineering',
        'Synthetic public job content.', ${"a".repeat(64)}, ${`synthetic-${slug}`}, 'active',
        ${epoch}, ${epoch}, ${new Date(epoch.getTime() + 72 * 60 * 60 * 1_000)},
        ${sourceUrl}, ${client.json([{ address: { addressCountry: "US" } }])},
        ${new Date(epoch.getTime() + 48 * 60 * 60 * 1_000)}, ${epoch}, ${epoch}
      )
    `;
    await client`
      INSERT INTO jobs.job_sources (
        id, job_id, provider, provenance, ats_tenant, external_job_id,
        source_url, canonical_url, canonical_url_hash, content_hash, adapter_version,
        raw_snapshot, first_observed_at, last_observed_at, last_verified_at,
        valid_through, application_url, structured_locations, created_at, updated_at
      ) VALUES (
        ${sourceId}, ${jobId}, 'lever', 'authorized_fixture', 'synthetic', ${slug},
        ${sourceUrl}, ${sourceUrl},
        ${createHash("sha256").update(sourceUrl).digest("hex")}, ${"b".repeat(64)},
        'd2-job-page-v1', ${client.json({ synthetic: true, body: "must be erased" })},
        ${epoch}, ${epoch}, ${epoch},
        ${new Date(epoch.getTime() + 48 * 60 * 60 * 1_000)}, ${sourceUrl},
        ${client.json([{ address: { addressCountry: "US" } }])}, ${epoch}, ${epoch}
      )
    `;
    return {
      jobId,
      sourceId,
      provider: "lever" as const,
      pageVariant: "lever-posting-v1" as const,
      sourceUrl,
    };
  }

  beforeAll(async () => {
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(first.stdout.trim()).toBe(
      "Jobs migrations through 0025_job_report_retention applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(first.stdout.trim());
    await store.ping();
    await client`
      INSERT INTO jobs.companies (
        id, display_name, normalized_name, verified_domain, created_at, updated_at
      ) VALUES (
        ${companyId}, 'Synthetic Lifecycle Company', 'synthetic lifecycle company',
        'synthetic-lifecycle.example.test', ${epoch}, ${epoch}
      )
    `;
  });

  afterAll(async () => {
    await client.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      for (const jobId of createdJobIds) {
        await transaction`DELETE FROM jobs.canonical_jobs WHERE id = ${jobId}`;
      }
      await transaction`DELETE FROM jobs.companies WHERE id = ${companyId}`;
    });
    await client.end();
  });

  it("queues community signals without advancing freshness or closing a catalog job", async () => {
    const identity = await seedSource("community-priority");
    const normal = await service.enqueueCommunitySignal({
      identity,
      kind: "community_observation",
      signalReference: "contribution:synthetic-lifecycle",
      observedAt: epoch,
    });
    const high = await service.enqueueCommunitySignal({
      identity,
      kind: "candidate_closed_report",
      signalReference: "report:synthetic-lifecycle",
      observedAt: epoch,
    });
    await expect(
      service.enqueueCommunitySignal({
        identity,
        kind: "candidate_closed_report",
        signalReference: "report:synthetic-lifecycle",
        observedAt: epoch,
      }),
    ).resolves.toEqual(high);

    const [unchanged] = await client<
      Array<{ status: string; lastVerifiedAt: Date; evidenceCount: number; serialized: string }>
    >`
      SELECT canonical.status, canonical.last_verified_at AS "lastVerifiedAt",
        (SELECT count(*)::int FROM jobs.source_verification_evidence
          WHERE job_id = canonical.id) AS "evidenceCount",
        (SELECT jsonb_agg(to_jsonb(queue))::text FROM jobs.source_revalidation_queue queue
          WHERE queue.job_id = canonical.id) AS serialized
      FROM jobs.canonical_jobs canonical WHERE canonical.id = ${identity.jobId}
    `;
    expect(unchanged).toMatchObject({ status: "active", lastVerifiedAt: epoch, evidenceCount: 0 });
    expect(unchanged?.serialized).not.toContain(identity.sourceUrl);
    expect(unchanged?.serialized).not.toContain("contribution:synthetic-lifecycle");
    expect(unchanged?.serialized).not.toContain("report:synthetic-lifecycle");

    const [claimed] = await service.claim("worker:synthetic-lifecycle", epoch, 1);
    expect(claimed).toMatchObject({ id: high.id, priority: "high", attempt: 1, state: "claimed" });
    if (!claimed) throw new Error("Expected a high-priority claim");
    const failed = await service.failClaim(
      claimed,
      "worker:synthetic-lifecycle",
      epoch,
      "SyntheticProviderTimeout",
    );
    expect(failed).toMatchObject({ state: "pending", attempt: 1 });
    const [reclaimed] = await service.claim(
      "worker:synthetic-lifecycle",
      new Date(epoch.getTime() + 1_001),
      1,
    );
    expect(reclaimed).toMatchObject({ id: high.id, attempt: 2, state: "claimed" });
    if (!reclaimed) throw new Error("Expected the failed claim to be reclaimed");

    const verifiedAt = new Date(epoch.getTime() + 2_000);
    const evidence = {
      ...identity,
      evidenceKind: "independent_positive_verification" as const,
      evidenceDigestSha256: "c".repeat(64),
      verifiedAt,
      recordedAt: verifiedAt,
      claim: { id: reclaimed.id, workerId: "worker:synthetic-lifecycle" },
    };
    const accepted = await service.recordIndependentEvidence(evidence);
    expect(accepted).toMatchObject({ fromStatus: "active", toStatus: "active", replayed: false });
    if (!accepted.evidenceId) throw new Error("Expected persisted independent evidence");
    await expect(service.recordIndependentEvidence(evidence)).resolves.toMatchObject({
      replayed: true,
    });
    const [acceptedState] = await client<
      Array<{ lastVerifiedAt: Date; evidenceCount: number; queueState: string }>
    >`
      SELECT canonical.last_verified_at AS "lastVerifiedAt",
        (SELECT count(*)::int FROM jobs.source_verification_evidence
          WHERE job_id = canonical.id) AS "evidenceCount",
        (SELECT state FROM jobs.source_revalidation_queue WHERE id = ${reclaimed.id}) AS "queueState"
      FROM jobs.canonical_jobs canonical WHERE canonical.id = ${identity.jobId}
    `;
    expect(acceptedState).toEqual({
      lastVerifiedAt: verifiedAt,
      evidenceCount: 1,
      queueState: "completed",
    });
    await expect(
      client`UPDATE jobs.source_verification_evidence SET policy_version = 'tampered-v1'
        WHERE id = ${accepted.evidenceId}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      client`UPDATE jobs.source_revalidation_queue SET updated_at = clock_timestamp()
        WHERE id = ${reclaimed.id}`,
    ).rejects.toMatchObject({ code: "55000" });
    expect(normal.priority).toBe("normal");
  });

  it("uses policy time to mark suspect then expire a minimal tombstone", async () => {
    const identity = await seedSource("policy-expiry");
    const suspectAt = new Date(epoch.getTime() + 24 * 60 * 60 * 1_000);
    await expect(service.applyFreshnessClock(identity, suspectAt)).resolves.toMatchObject({
      fromStatus: "active",
      toStatus: "suspect_stale",
    });
    const [suspect] = await client<Array<{ priority: number; signalKind: string }>>`
      SELECT priority, signal_kind AS "signalKind"
      FROM jobs.source_revalidation_queue
      WHERE job_id = ${identity.jobId} AND signal_kind = 'policy_suspect'
    `;
    expect(suspect).toEqual({ priority: 2, signalKind: "policy_suspect" });

    const expiresAt = new Date(epoch.getTime() + 72 * 60 * 60 * 1_000);
    await expect(service.applyFreshnessClock(identity, expiresAt)).resolves.toMatchObject({
      fromStatus: "suspect_stale",
      toStatus: "expired",
    });
    const [tombstone] = await client<
      Array<{
        status: string;
        description: string | null;
        applicationUrl: string | null;
        rawSnapshot: unknown;
        sourceApplicationUrl: string | null;
      }>
    >`
      SELECT canonical.status, canonical.description,
        canonical.application_url AS "applicationUrl", source.raw_snapshot AS "rawSnapshot",
        source.application_url AS "sourceApplicationUrl"
      FROM jobs.canonical_jobs canonical
      JOIN jobs.job_sources source ON source.job_id = canonical.id
      WHERE canonical.id = ${identity.jobId}
    `;
    expect(tombstone).toEqual({
      status: "expired",
      description: null,
      applicationUrl: null,
      rawSnapshot: null,
      sourceApplicationUrl: null,
    });
    const events = await client<Array<{ reason: string }>>`
      SELECT reason FROM jobs.status_events WHERE job_id = ${identity.jobId} ORDER BY occurred_at
    `;
    expect(events.map((event) => event.reason)).toEqual([
      "d2.policy_suspect_window_elapsed",
      "d2.policy_expiry_window_elapsed",
    ]);
    expect(JSON.stringify(events)).not.toContain(identity.sourceUrl);
  });

  it("withdraws only on independent closed evidence and blocks only after authority", async () => {
    const closed = await seedSource("independent-closed");
    const survivingSourceId = uuidv7();
    const survivingSourceUrl = "https://jobs.lever.co/synthetic/independent-open";
    await client`
      INSERT INTO jobs.job_sources (
        id, job_id, provider, provenance, ats_tenant, external_job_id,
        source_url, canonical_url, canonical_url_hash, content_hash, adapter_version,
        raw_snapshot, first_observed_at, last_observed_at, last_verified_at,
        valid_through, application_url, structured_locations, created_at, updated_at
      ) VALUES (
        ${survivingSourceId}, ${closed.jobId}, 'lever', 'authorized_fixture', 'synthetic',
        'independent-open', ${survivingSourceUrl}, ${survivingSourceUrl},
        ${createHash("sha256").update(survivingSourceUrl).digest("hex")}, ${"f".repeat(64)},
        'd2-job-page-v1', ${client.json({ synthetic: true, body: "second source" })},
        ${epoch}, ${epoch}, ${epoch},
        ${new Date(epoch.getTime() + 48 * 60 * 60 * 1_000)}, ${survivingSourceUrl},
        ${client.json([{ address: { addressCountry: "US" } }])}, ${epoch}, ${epoch}
      )
    `;
    const verifiedAt = new Date(epoch.getTime() + 5_000);
    await expect(
      service.recordIndependentEvidence({
        ...closed,
        evidenceKind: "independent_closed_verification",
        evidenceDigestSha256: "d".repeat(64),
        verifiedAt,
        recordedAt: verifiedAt,
      }),
    ).resolves.toMatchObject({ fromStatus: "active", toStatus: "active" });
    const [survivingCanonical] = await client<
      Array<{
        status: string;
        statusReason: string | null;
        lastVerifiedAt: Date;
        expiresAt: Date;
        closedSourceWithdrawnAt: Date | null;
      }>
    >`
      SELECT canonical.status, canonical.status_reason AS "statusReason",
        canonical.last_verified_at AS "lastVerifiedAt", canonical.expires_at AS "expiresAt",
        closed_source.withdrawn_at AS "closedSourceWithdrawnAt"
      FROM jobs.canonical_jobs canonical
      JOIN jobs.job_sources closed_source ON closed_source.id = ${closed.sourceId}
      WHERE canonical.id = ${closed.jobId}
    `;
    expect(survivingCanonical).toEqual({
      status: "active",
      statusReason: null,
      lastVerifiedAt: epoch,
      expiresAt: new Date(epoch.getTime() + 72 * 60 * 60 * 1_000),
      closedSourceWithdrawnAt: verifiedAt,
    });
    await expect(
      service.recordIndependentEvidence({
        jobId: closed.jobId,
        sourceId: survivingSourceId,
        provider: "lever",
        pageVariant: "lever-posting-v1",
        evidenceKind: "independent_closed_verification",
        evidenceDigestSha256: "9".repeat(64),
        verifiedAt: new Date(verifiedAt.getTime() + 1_000),
        recordedAt: new Date(verifiedAt.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ fromStatus: "active", toStatus: "withdrawn" });

    const blocked = await seedSource("administrative-block");
    await expect(
      service.recordAdministrativeBlock({
        jobId: blocked.jobId,
        decisionId: "decision:synthetic-lifecycle",
        evidenceDigestSha256: "e".repeat(64),
        policyVersion: "synthetic-admin-policy-v1",
        reasonCode: "verified_malicious_listing",
        decidedAt: verifiedAt,
        recordedAt: verifiedAt,
      }),
    ).resolves.toMatchObject({ fromStatus: "active", toStatus: "blocked" });
    const [counts] = await client<{ closed: number; blocked: number }[]>`
      SELECT
        count(*) FILTER (WHERE evidence_kind = 'independent_closed_verification')::int AS closed,
        count(*) FILTER (WHERE evidence_kind = 'authorized_administrative_block')::int AS blocked
      FROM jobs.source_verification_evidence
      WHERE job_id IN (${closed.jobId}, ${blocked.jobId})
    `;
    expect(counts).toEqual({ closed: 2, blocked: 1 });
  });
});
