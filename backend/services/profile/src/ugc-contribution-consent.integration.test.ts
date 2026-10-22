import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index.js";
import {
  PostgresUgcContributionConsentStore,
  UgcContributionConsentConflictError,
} from "./ugc-contribution-consent.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresUgcContributionConsentStore", () => {
  const database = createDatabase(databaseUrl ?? "postgres://invalid");
  const store = new PostgresUgcContributionConsentStore(database.client);
  const ownerUserId = uuidv7();
  const otherUserId = uuidv7();

  async function authorizeCandidateDeletion(userId: string): Promise<string> {
    const operationId = uuidv7();
    const requestId = uuidv7();
    await database.client`
      INSERT INTO platform.operations (id, user_id, kind, state)
      VALUES (${operationId}::uuid, ${userId}::uuid, 'account_deletion', 'queued')
    `;
    await database.client`
      INSERT INTO profile.account_deletion_requests (
        id, user_id, operation_id, policy_version, state, version,
        confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}::uuid, ${userId}::uuid, ${operationId}::uuid,
        'd2-candidate-rights-test.v1', 'quarantined', 1,
        '2026-09-01T15:00:00.000Z'::timestamptz,
        '2026-09-08T15:00:00.000Z'::timestamptz
      )
    `;
    await database.client`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}::uuid, ${"1".repeat(64)}, 'd2-candidate-rights-test.v1',
        ${"2".repeat(64)}, 'quarantined', ${JSON.stringify({ profile: "pending" })}::jsonb,
        ${JSON.stringify({})}::jsonb, '2026-09-01T15:00:00.000Z'::timestamptz,
        '2026-09-08T15:00:00.000Z'::timestamptz
      )
    `;
    return requestId;
  }

  beforeAll(async () => {
    // This suite must initialize its own identity/privacy prerequisites when run on its own.
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const migration = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(migration.stdout.trim()).toBe(
      "Database migrations through 0014_retire_profile_facts applied and verified.",
    );
    await database.client`
      INSERT INTO identity.users (id, account_state) VALUES
        (${ownerUserId}::uuid, 'active'),
        (${otherUserId}::uuid, 'active')
    `;
  });

  afterAll(async () => {
    for (const userId of [ownerUserId, otherUserId]) {
      const [remaining] = await database.client<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM profile.ugc_contribution_consents
        WHERE owner_user_id = ${userId}::uuid
      `;
      if ((remaining?.count ?? 0) > 0) {
        const requestId = await authorizeCandidateDeletion(userId);
        await database.client`
          SELECT profile.delete_candidate_data(${userId}::uuid, ${requestId}::uuid)
        `;
      }
    }
    await database.client`
      DELETE FROM platform.audit_events
      WHERE user_id IN (${ownerUserId}::uuid, ${otherUserId}::uuid)
    `;
    await database.client`
      DELETE FROM identity.users WHERE id IN (${ownerUserId}::uuid, ${otherUserId}::uuid)
    `;
    await database.client.end();
  });

  it("records, replays, verifies, supersedes, and revokes immutable owner-scoped grants", async () => {
    const grantCommand = {
      documentVersion: "ugc-contribution-preview.v1",
      expiresAt: "2026-09-03T12:00:00.000Z",
      grantedAt: "2026-09-01T12:00:00.000Z",
      idempotencyKey: `ugc-consent-grant-${uuidv7()}`,
      ownerUserId,
      policyVersion: "d2-ugc-policy.v1",
      previewPayloadSha256: "a".repeat(64),
      traceId: "integration-ugc-consent",
    } as const;
    const first = await store.grant(grantCommand);
    await expect(store.grant(grantCommand)).resolves.toEqual(first);
    await expect(
      store.grant({ ...grantCommand, grantedAt: "2026-09-01T12:00:05.000Z" }),
    ).resolves.toEqual(first);
    await expect(
      store.grant({ ...grantCommand, previewPayloadSha256: "b".repeat(64) }),
    ).rejects.toBeInstanceOf(UgcContributionConsentConflictError);

    await expect(
      store.verify({
        consentId: first.id,
        documentVersion: grantCommand.documentVersion,
        ownerUserId,
        policyVersion: grantCommand.policyVersion,
        previewPayloadSha256: grantCommand.previewPayloadSha256,
        verifiedAt: "2026-09-01T12:00:01.000Z",
      }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      store.verify({
        consentId: first.id,
        documentVersion: grantCommand.documentVersion,
        ownerUserId: otherUserId,
        policyVersion: grantCommand.policyVersion,
        previewPayloadSha256: grantCommand.previewPayloadSha256,
        verifiedAt: "2026-09-01T12:00:01.000Z",
      }),
    ).resolves.toEqual({ reason: "not_found", valid: false });
    await expect(
      store.verify({
        consentId: uuidv7(),
        documentVersion: grantCommand.documentVersion,
        ownerUserId,
        policyVersion: grantCommand.policyVersion,
        previewPayloadSha256: grantCommand.previewPayloadSha256,
        verifiedAt: "2026-09-01T12:00:01.000Z",
      }),
    ).resolves.toEqual({ reason: "not_found", valid: false });
    await expect(
      store.verify({
        consentId: first.id,
        documentVersion: grantCommand.documentVersion,
        ownerUserId,
        policyVersion: grantCommand.policyVersion,
        previewPayloadSha256: "c".repeat(64),
        verifiedAt: "2026-09-01T12:00:01.000Z",
      }),
    ).resolves.toEqual({ reason: "mismatch", valid: false });
    await expect(
      store.verify({
        consentId: first.id,
        documentVersion: grantCommand.documentVersion,
        ownerUserId,
        policyVersion: grantCommand.policyVersion,
        previewPayloadSha256: grantCommand.previewPayloadSha256,
        verifiedAt: grantCommand.expiresAt,
      }),
    ).resolves.toEqual({ reason: "expired", valid: false });

    const replacement = await store.grant({
      ...grantCommand,
      grantedAt: "2026-09-01T12:01:00.000Z",
      idempotencyKey: `ugc-consent-grant-${uuidv7()}`,
      previewPayloadSha256: "d".repeat(64),
    });
    const superseded = await store.supersede({
      consentId: first.id,
      idempotencyKey: `ugc-consent-supersede-${uuidv7()}`,
      occurredAt: "2026-09-01T12:02:00.000Z",
      ownerUserId,
      replacementConsentId: replacement.id,
      traceId: "integration-ugc-consent",
    });
    expect(superseded).toMatchObject({ replacementConsentId: replacement.id, state: "superseded" });
    await expect(
      store.verify({
        consentId: first.id,
        documentVersion: grantCommand.documentVersion,
        ownerUserId,
        policyVersion: grantCommand.policyVersion,
        previewPayloadSha256: grantCommand.previewPayloadSha256,
        verifiedAt: "2026-09-01T12:02:01.000Z",
      }),
    ).resolves.toEqual({ reason: "not_current", valid: false });

    const revokeCommand = {
      consentId: replacement.id,
      idempotencyKey: `ugc-consent-revoke-${uuidv7()}`,
      occurredAt: "2026-09-01T12:03:00.000Z",
      ownerUserId,
      traceId: "integration-ugc-consent",
    } as const;
    const revoked = await store.revoke(revokeCommand);
    expect(revoked.state).toBe("revoked");
    await expect(
      store.revoke({ ...revokeCommand, occurredAt: "2026-09-01T12:04:00.000Z" }),
    ).resolves.toEqual(revoked);
    await expect(
      store.verify({
        consentId: replacement.id,
        documentVersion: grantCommand.documentVersion,
        ownerUserId,
        policyVersion: grantCommand.policyVersion,
        previewPayloadSha256: "d".repeat(64),
        verifiedAt: "2026-09-01T12:03:01.000Z",
      }),
    ).resolves.toEqual({ reason: "not_current", valid: false });

    const [audit] = await database.client<Array<{ metadata: unknown }>>`
      SELECT metadata FROM platform.audit_events
      WHERE user_id = ${ownerUserId}::uuid AND resource_id = ${first.id}::uuid
        AND action = 'ugc_contribution_consent.granted'
    `;
    expect(audit?.metadata).toEqual({
      client: "extension",
      documentVersion: grantCommand.documentVersion,
      policyVersion: grantCommand.policyVersion,
      purpose: "ugc_contribution",
    });
    expect(JSON.stringify(audit)).not.toContain(grantCommand.previewPayloadSha256);

    await expect(
      database.client`
        UPDATE profile.ugc_contribution_consents
        SET policy_version = 'tampered-policy.v1'
        WHERE consent_id = ${first.id}::uuid
      `,
    ).rejects.toThrow("append-only");
  });

  it("exports only allowlisted owner consent history and deletes it only under candidate rights authorization", async () => {
    const otherConsent = await store.grant({
      documentVersion: "ugc-contribution-preview.v1",
      expiresAt: "2026-09-04T12:00:00.000Z",
      grantedAt: "2026-09-01T13:00:00.000Z",
      idempotencyKey: `ugc-consent-other-${uuidv7()}`,
      ownerUserId: otherUserId,
      policyVersion: "d2-ugc-policy.v1",
      previewPayloadSha256: "e".repeat(64),
      traceId: "integration-ugc-consent-rights",
    });

    const [exported] = await database.client<
      Array<{
        data: {
          profile: { contributionConsents: Array<Record<string, unknown>> };
        };
      }>
    >`
      SELECT profile.export_candidate_data(${ownerUserId}::uuid) AS data
    `;
    const consents = exported?.data.profile.contributionConsents ?? [];
    expect(consents).toHaveLength(4);
    expect(consents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client: "extension",
          documentVersion: "ugc-contribution-preview.v1",
          policyVersion: "d2-ugc-policy.v1",
          purpose: "ugc_contribution",
        }),
      ]),
    );
    const serializedExport = JSON.stringify(exported?.data);
    expect(serializedExport).not.toContain(otherConsent.id);
    expect(serializedExport).not.toContain("previewPayloadSha256");
    expect(serializedExport).not.toContain("preview_payload_sha256");
    expect(serializedExport).not.toContain("supersedesRecordId");
    expect(serializedExport).not.toContain("idempotency");
    expect(serializedExport).not.toContain("a".repeat(64));
    expect(serializedExport).not.toContain("d".repeat(64));

    let directDeleteCode: string | undefined;
    try {
      await database.client`
        DELETE FROM profile.ugc_contribution_consents
        WHERE owner_user_id = ${ownerUserId}::uuid
      `;
    } catch (error) {
      directDeleteCode = (error as { code?: string }).code;
    }
    expect(directDeleteCode).toBe("55000");

    let unauthorizedCode: string | undefined;
    try {
      await database.client`
        SELECT profile.delete_candidate_data(${ownerUserId}::uuid, ${uuidv7()}::uuid)
      `;
    } catch (error) {
      unauthorizedCode = (error as { code?: string }).code;
    }
    expect(unauthorizedCode).toBe("42501");

    const requestId = await authorizeCandidateDeletion(ownerUserId);
    const [deletion] = await database.client<
      Array<{ result: { contributionConsentsDeleted: number; owner: string } }>
    >`
      SELECT profile.delete_candidate_data(${ownerUserId}::uuid, ${requestId}::uuid) AS result
    `;
    expect(deletion?.result).toMatchObject({
      contributionConsentsDeleted: 4,
      owner: "profile",
    });

    const [remaining] = await database.client<
      Array<{ otherCount: number; ownerCount: number; ownerReceiptCount: number }>
    >`
      SELECT
        count(*) FILTER (WHERE owner_user_id = ${ownerUserId}::uuid)::int AS "ownerCount",
        count(*) FILTER (WHERE owner_user_id = ${otherUserId}::uuid)::int AS "otherCount",
        (
          SELECT count(*)::int FROM platform.idempotency_keys
          WHERE user_id = ${ownerUserId}::uuid
            AND scope LIKE 'ugc_contribution_consent.%'
        ) AS "ownerReceiptCount"
      FROM profile.ugc_contribution_consents
    `;
    expect(remaining).toEqual({ ownerCount: 0, otherCount: 1, ownerReceiptCount: 0 });

    await expect(
      database.client`
        UPDATE profile.ugc_contribution_consents
        SET policy_version = 'tampered-policy.v1'
        WHERE owner_user_id = ${otherUserId}::uuid
      `,
    ).rejects.toThrow("append-only");
  });
});
