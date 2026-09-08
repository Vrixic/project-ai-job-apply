import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { CreateJobContributionCommand } from "../contribution.js";
import {
  DevelopmentContributionCapabilitySource,
  DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
  DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION,
} from "../contribution-capability-source.js";
import { ContributionProcessingService } from "../contribution-processing.js";
import { normalizeContributionForProcessing } from "../contribution-processing-policy.js";
import { canonicalizeObservation } from "../domain/canonical-job.js";
import { createJobCatalogDatabase, PostgresJobCatalog } from "./catalog.js";
import { PostgresJobContributionStore } from "./contribution.js";
import {
  PostgresContributionProcessingStore,
  PostgresContributionPublicationReconciler,
} from "./contribution-processing.js";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("development contribution publication leases", () => {
  const client = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 3,
  });
  const store = new PostgresContributionProcessingStore(client);
  const intake = new PostgresJobContributionStore(client);
  afterAll(async () => {
    await client.end();
  });
  const started = new Date("2050-09-08T12:00:00.000Z");
  function lease(contributionId: string, at = started) {
    return {
      contributionId,
      processingPolicyVersion: "synthetic-processing-v1",
      capabilityPolicyVersion: DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION,
      capabilityConfigurationDigestSha256: DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
      capabilityEvaluatedAt: at.toISOString(),
      capabilityExpiresAt: new Date(at.getTime() + 60_000).toISOString(),
      developmentOperationLease: true as const,
      occurredAt: at,
    };
  }
  async function fixture() {
    const id = uuidv7();
    const externalJobId = Number.parseInt(id.replaceAll("-", "").slice(-10), 16).toString();
    const url = `https://job-boards.greenhouse.io/synthetic-development/jobs/${externalJobId}`;
    const command: CreateJobContributionCommand = {
      ownerUserId: uuidv7(),
      idempotencyKey: `dev-lease-${id}`,
      input: {
        schemaVersion: 1,
        contributionId: id,
        client: { surface: "browser_extension", version: "0.2.0" },
        source: {
          provider: "greenhouse",
          pageVariant: "greenhouse-board-v1",
          sourceUrl: url,
          externalJobId,
          adapterVersion: "d2-job-page-v1",
        },
        posting: {
          companyName: `Synthetic ${id}`,
          title: `Engineer ${id}`,
          description: `Independently fetched synthetic provider content ${id}`,
          locations: ["Remote"],
        },
        observation: { observedAt: "2026-09-01T12:00:00.000Z", contentSha256: "a".repeat(64) },
        approval: {
          consentId: uuidv7(),
          consentVersion: "ugc-contribution-preview.v1",
          policyVersion: "synthetic-ugc-v1",
          approvedAt: "2026-09-01T12:00:00.000Z",
          approvedFields: [],
          previewDigestSha256: "b".repeat(64),
        },
      },
    };
    await intake.create(command);
    await store.recordNormalization({
      contributionId: id,
      proposal: normalizeContributionForProcessing(command.input),
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: started,
    });
    const observation = {
      provider: "greenhouse" as const,
      provenance: "permitted_api" as const,
      companyName: command.input.posting.companyName as string,
      title: command.input.posting.title,
      description: command.input.posting.description as string,
      locations: ["Remote"],
      sourceUrl: url,
      atsTenant: "synthetic-development",
      externalJobId,
      adapterVersion: "greenhouse-v1",
      observedAt: started,
    };
    const canonical = canonicalizeObservation(observation);
    await store.recordIndependentVerification({
      contributionId: id,
      evidence: {
        status: "verified",
        origin: "independent_provider_fetch",
        contributionId: id,
        verificationId: uuidv7(),
        provider: "greenhouse",
        pageVariant: "greenhouse-board-v1",
        canonicalSourceUrlSha256: canonical.canonicalUrlHash,
        evidenceDigestSha256: createHash("sha256").update(id).digest("hex"),
        verifiedContentSha256: canonical.contentHash,
        providerObservation: observation,
        sourcePolicyVersion: "synthetic-source-v1",
        verifiedAt: started.toISOString(),
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: started,
    });
    await store.recordTrustDecision({
      contributionId: id,
      decision: {
        status: "accepted",
        contributionId: id,
        decisionId: uuidv7(),
        policyVersion: "synthetic-trust-v1",
        decidedAt: started.toISOString(),
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: started,
    });
    return { id, command };
  }

  it("renews expired leases idempotently under concurrency, fences stale commands, and publishes once", async () => {
    const { id } = await fixture();
    const first = await store.preparePublication(lease(id));
    const at = new Date(started.getTime() + 61_000);
    const catalog = new PostgresJobCatalog(client, {
      acceptedProvenance: new Set(["permitted_api"]),
      searchCursorKeys: { active: { id: "synthetic-lease", key: Buffer.alloc(32, 7) } },
    });
    const reconciler = new PostgresContributionPublicationReconciler(client, catalog, () => at);
    await expect(reconciler.publish(first)).rejects.toThrow("not authorized");
    const [left, right] = await Promise.all([
      store.preparePublication(lease(id, at)),
      store.preparePublication(lease(id, at)),
    ]);
    expect(left).toEqual(right);
    expect(left.reconciliationId).toBe(first.reconciliationId);
    expect(left.capabilityExpiresAt).toBe("2050-09-08T12:02:01.000Z");
    const [row] = await client<
      { created: Date; count: number }[]
    >`SELECT created_at AS created, (count(*) OVER ())::int AS count FROM jobs.job_contribution_reconciliations WHERE contribution_id=${id}`;
    if (!row) throw new Error("Expected the single prepared reconciliation");
    expect(new Date(row.created).toISOString()).toBe(started.toISOString());
    expect(row?.count).toBe(1);
    await expect(reconciler.publish(first)).rejects.toThrow("not authorized");
    const applied = await reconciler.publish(left);
    expect(await reconciler.publish(right)).toEqual(applied);
    await expect(
      store.preparePublication(lease(id, new Date(at.getTime() + 61_000))),
    ).rejects.toThrow("immutable");
  });

  it("automatically refreshes an expired prepared lease through normal processing after fresh consent checks", async () => {
    const { id } = await fixture();
    const first = await store.preparePublication(lease(id));
    const at = new Date(started.getTime() + 86_400_000);
    const capability = new DevelopmentContributionCapabilitySource({
      D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
      D2_DEPLOYMENT_ENVIRONMENT: "development",
      D2_COMMUNITY_RUNTIME_ENABLED: "true",
    });
    const consent = { verifyCurrent: vi.fn(async () => ({ status: "current" as const })) };
    const catalog = new PostgresJobCatalog(client, {
      acceptedProvenance: new Set(["permitted_api"]),
      searchCursorKeys: { active: { id: "synthetic-lease", key: Buffer.alloc(32, 7) } },
    });
    const service = new ContributionProcessingService({
      store,
      capability,
      consent,
      policy: { version: "synthetic-processing-v1" },
      now: () => at,
      reconciler: new PostgresContributionPublicationReconciler(client, catalog, () => at),
    });
    await expect(service.process(id)).resolves.toBe("published");
    expect(consent.verifyCurrent).toHaveBeenCalledTimes(2);
    const loaded = await store.load(id);
    expect(loaded?.publication?.reconciliationId).toBe(first.reconciliationId);
    await expect(service.process(id)).resolves.toBe("published");
  });

  it("does not renew under disabled mode, changed capability, revoked consent or changed Trust", async () => {
    const { id } = await fixture();
    const first = await store.preparePublication(lease(id));
    const at = new Date(started.getTime() + 61_000);
    const values = {
      D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
      D2_DEPLOYMENT_ENVIRONMENT: "development",
      D2_COMMUNITY_RUNTIME_ENABLED: "false",
    };
    const capability = new DevelopmentContributionCapabilitySource(values);
    const publish = vi.fn();
    const dependencies = {
      store,
      capability,
      policy: { version: "synthetic-processing-v1" },
      consent: { verifyCurrent: async () => ({ status: "current" as const }) },
      reconciler: { publish, remove: vi.fn() },
      now: () => at,
    };
    await expect(new ContributionProcessingService(dependencies).process(id)).resolves.toBe(
      "capability_disabled",
    );
    expect(publish).not.toHaveBeenCalled();
    await expect(
      store.preparePublication({
        ...lease(id, at),
        capabilityConfigurationDigestSha256: "f".repeat(64),
      }),
    ).rejects.toThrow("invalid");
    await expect(
      client.begin(async (transaction) => {
        await transaction`SELECT set_config('ai_job_apply.development_contribution_lease','renew',true)`;
        await transaction`UPDATE jobs.job_contribution_reconciliations SET independent_verification_id=${uuidv7()}, capability_evaluated_at=${at}, capability_expires_at=${new Date(at.getTime() + 60_000)}, updated_at=${at} WHERE id=${first.reconciliationId}`;
      }),
    ).rejects.toMatchObject({ code: "55000" });
    values.D2_COMMUNITY_RUNTIME_ENABLED = "true";
    await expect(
      new ContributionProcessingService({
        ...dependencies,
        consent: { verifyCurrent: async () => ({ status: "invalid" as const }) },
      }).process(id),
    ).resolves.toBe("consent_invalid");
    await expect(store.preparePublication(lease(id, at))).rejects.toThrow("gates");
    const other = await fixture();
    await store.preparePublication(lease(other.id));
    await store.recordTrustDecision({
      contributionId: other.id,
      decision: {
        status: "accepted",
        contributionId: other.id,
        decisionId: uuidv7(),
        policyVersion: "synthetic-trust-v1",
        decidedAt: at.toISOString(),
      },
      processingPolicyVersion: "synthetic-processing-v1",
      occurredAt: at,
    });
    await expect(store.preparePublication(lease(other.id, at))).rejects.toThrow("policy changed");
  });

  it("keeps signed-policy rows immutable and requires the exact lease marker and duration", async () => {
    const { id } = await fixture();
    const at = new Date(started.getTime() + 61_000);
    const { developmentOperationLease: _unused, ...signed } = lease(id);
    const first = await store.preparePublication({
      ...signed,
      capabilityPolicyVersion: "synthetic-signed-v1",
      capabilityConfigurationDigestSha256: "f".repeat(64),
    });
    await expect(
      client.begin(async (transaction) => {
        await transaction`SELECT set_config('ai_job_apply.development_contribution_lease','renew',true)`;
        await transaction`UPDATE jobs.job_contribution_reconciliations SET capability_evaluated_at=${at}, capability_expires_at=${new Date(at.getTime() + 60_000)}, updated_at=${at} WHERE id=${first.reconciliationId}`;
      }),
    ).rejects.toMatchObject({ code: "55000" });
    const other = await fixture();
    const dev = await store.preparePublication(lease(other.id));
    await expect(
      client`UPDATE jobs.job_contribution_reconciliations SET capability_evaluated_at=${at}, capability_expires_at=${new Date(at.getTime() + 60_000)}, updated_at=${at} WHERE id=${dev.reconciliationId}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      store.preparePublication({
        ...lease(other.id, at),
        capabilityExpiresAt: new Date(at.getTime() + 60_001).toISOString(),
      }),
    ).rejects.toThrow("invalid");
  });
});
