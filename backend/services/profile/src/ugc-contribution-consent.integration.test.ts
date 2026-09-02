import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index.js";
import {
  PostgresUgcContributionConsentStore,
  UgcContributionConsentConflictError,
} from "./ugc-contribution-consent.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresUgcContributionConsentStore", () => {
  const database = createDatabase(databaseUrl ?? "postgres://invalid");
  const store = new PostgresUgcContributionConsentStore(database.client);
  const ownerUserId = uuidv7();
  const otherUserId = uuidv7();

  beforeAll(async () => {
    await database.client`
      INSERT INTO identity.users (id, account_state) VALUES
        (${ownerUserId}::uuid, 'active'),
        (${otherUserId}::uuid, 'active')
    `;
  });

  afterAll(async () => {
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
});
