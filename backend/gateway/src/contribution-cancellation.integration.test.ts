import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type CreateJobContributionCommand,
  createJobCatalogDatabase,
  JobContributionService,
  PostgresJobContributionStore,
} from "@ai-job-apply/jobs-service";
import { createDatabase, PostgresUgcContributionConsentStore } from "@ai-job-apply/profile-service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProfileJobContributionConsentRevoker } from "./job-contribution-consent-verifier.js";

// Opt in only against an isolated disposable loopback PostgreSQL cluster. Jobs
// migrations verify cluster-global public-reader grants, so a generated database
// on the normal already-migrated DATABASE_URL cluster is not isolated enough.
// The harness creates and removes only its own d2_cancellation_<uuid> database.
const databaseUrl = process.env.D2_CANCELLATION_DATABASE_URL;
const execFileAsync = promisify(execFile);

(databaseUrl ? describe : describe.skip)("composed Profile/Jobs owner cancellation", () => {
  const databaseName = `d2_cancellation_${randomUUID().replaceAll("-", "")}`;
  const administrator = createJobCatalogDatabase(databaseUrl ?? "postgres://invalid");
  let created = false;
  let client: ReturnType<typeof createJobCatalogDatabase> | undefined;

  beforeAll(async () => {
    if (!databaseUrl || !/^d2_cancellation_[a-f0-9]{32}$/u.test(databaseName)) {
      throw new Error("A generated local cancellation test database is required");
    }
    const target = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    ) {
      throw new Error(
        "D2_CANCELLATION_DATABASE_URL must target an isolated disposable loopback cluster",
      );
    }
    await administrator.unsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    target.pathname = `/${databaseName}`;
    for (const owner of ["profile", "jobs"]) {
      await execFileAsync(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        {
          env: { ...process.env, DATABASE_URL: target.toString() },
        },
      );
    }
    // Match the shared two-connection Gateway pool and its Drizzle serializer setup.
    client = createDatabase(target.toString(), { maxConnections: 2 }).client;
  }, 30_000);

  afterAll(async () => {
    await client?.end();
    if (created) await administrator.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await administrator.end();
  });

  it("concurrently commits two cancellations and their exact Profile revocations without pooled transaction deadlock", async () => {
    if (!client) throw new Error("Test database not ready");
    const consents = new PostgresUgcContributionConsentStore(client);
    const intake = new PostgresJobContributionStore(client);
    const service = new JobContributionService(
      intake,
      undefined,
      undefined,
      undefined,
      new ProfileJobContributionConsentRevoker(consents),
    );
    const commands: CreateJobContributionCommand[] = [];
    for (let index = 0; index < 2; index += 1) {
      const ownerUserId = uuidv7();
      await client`INSERT INTO identity.users (id) VALUES (${ownerUserId})`;
      const contributionId = uuidv7();
      const grantedAt = new Date().toISOString();
      const grant = await consents.grant({
        ownerUserId,
        documentVersion: "ugc-contribution-preview.v1",
        policyVersion: "synthetic-cancellation-v1",
        previewPayloadSha256: "b".repeat(64),
        grantedAt,
        idempotencyKey: `synthetic-grant-${contributionId}`,
        traceId: "synthetic-cancel",
      });
      const command: CreateJobContributionCommand = {
        ownerUserId,
        idempotencyKey: `synthetic-intake-${contributionId}`,
        input: {
          schemaVersion: 1,
          contributionId,
          client: { surface: "browser_extension", version: "0.2.0" },
          source: {
            provider: "greenhouse",
            pageVariant: "greenhouse-board-v1",
            adapterVersion: "d2-job-page-v1",
            sourceUrl: `https://job-boards.greenhouse.io/synthetic/jobs/${index + 1}`,
            externalJobId: String(index + 1),
          },
          posting: { title: "Synthetic Platform Engineer" },
          observation: { observedAt: grantedAt, contentSha256: "a".repeat(64) },
          approval: {
            consentId: grant.id,
            consentVersion: "ugc-contribution-preview.v1",
            policyVersion: grant.policyVersion,
            approvedAt: grant.grantedAt,
            approvedFields: ["provider", "pageVariant", "sourceUrl", "externalJobId", "title"],
            previewDigestSha256: "b".repeat(64),
          },
        },
      };
      await intake.create(command);
      commands.push(command);
    }
    const results = await Promise.all(
      commands.map((command) =>
        service.cancel({
          ownerUserId: command.ownerUserId,
          contributionId: command.input.contributionId,
          idempotencyKey: `synthetic-cancel-${command.input.contributionId}`,
          traceId: "synthetic-cancel",
        }),
      ),
    );
    expect(results.map((result) => result?.state)).toEqual(["consent_invalid", "consent_invalid"]);
    for (const command of commands) {
      await expect(
        consents.verify({
          ownerUserId: command.ownerUserId,
          consentId: command.input.approval.consentId,
          documentVersion: command.input.approval.consentVersion,
          policyVersion: command.input.approval.policyVersion,
          previewPayloadSha256: command.input.approval.previewDigestSha256,
          verifiedAt: new Date().toISOString(),
        }),
      ).resolves.toEqual({ valid: false, reason: "not_current" });
      await expect(
        service.cancel({
          ownerUserId: command.ownerUserId,
          contributionId: command.input.contributionId,
          idempotencyKey: `retry-cancel-${command.input.contributionId}`,
          traceId: "synthetic-retry",
        }),
      ).resolves.toEqual(results.find((result) => result?.id === command.input.contributionId));
    }
    const [audit] = await client<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM platform.audit_events
      WHERE action = 'ugc_contribution_consent.revoked'
    `;
    expect(audit?.count).toBe("2");
  }, 10_000);
});
