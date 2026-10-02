import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTrustStore } from "./store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

interface CandidateDeletionAuthorization {
  operationId: string;
  requestId: string;
}

describeWithDatabase("Trust candidate rights ownership", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const store = new PostgresTrustStore(client);
  const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
  const profileMigrationExecutable = fileURLToPath(
    new URL("../../profile/dist/src/migrate.js", import.meta.url),
  );

  beforeAll(async () => {
    // Rights assertions require Profile authorization, not Turbo package execution order.
    const profile = await execFileAsync(process.execPath, [profileMigrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(profile.stdout.trim()).toBe(
      "Database migrations through 0011_active_candidate_lease applied and verified.",
    );
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(first.stdout.trim()).toBe(
      "Trust migrations through 0005_development_test_removal applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(first.stdout.trim());
  });

  afterAll(async () => {
    await client.end();
  });

  async function authorizeDeletion(userId: string): Promise<CandidateDeletionAuthorization> {
    const operationId = uuidv7();
    const requestId = uuidv7();
    const confirmedAt = new Date(Date.now() - 1_000);
    const backupExpiresAt = new Date(confirmedAt.getTime() + 35 * 24 * 60 * 60 * 1_000);
    await client`INSERT INTO identity.users (id) VALUES (${userId})`;
    await client`
      INSERT INTO platform.operations (id, user_id, kind, state)
      VALUES (${operationId}, ${userId}, 'account_deletion', 'queued')
    `;
    await client`
      INSERT INTO profile.account_deletion_requests (
        id, user_id, operation_id, policy_version, state, version,
        requested_at, updated_at, confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}, ${userId}, ${operationId}, 'synthetic-trust-rights-v1',
        'quarantined', 2, ${confirmedAt}, ${confirmedAt}, ${confirmedAt}, ${backupExpiresAt}
      )
    `;
    await client`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at
      ) VALUES (
        ${requestId}, ${"1".repeat(64)}, 'synthetic-trust-rights-v1', ${"2".repeat(64)},
        'quarantined', ${client.json({ trust: "pending" })}, ${client.json({})},
        ${confirmedAt}, ${backupExpiresAt}, ${confirmedAt}
      )
    `;
    return { operationId, requestId };
  }

  async function removeAuthorization(
    userId: string,
    authorization: CandidateDeletionAuthorization,
  ): Promise<void> {
    await client`
      DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${authorization.requestId}
    `;
    await client`DELETE FROM identity.users WHERE id = ${userId}`;
  }

  it("exports only the exact contributor's bounded, reviewer-redacted Trust data", async () => {
    const owner = uuidv7();
    const otherOwner = uuidv7();
    const ownerCaseId = uuidv7();
    const otherCaseId = uuidv7();
    const ownerContributionId = uuidv7();
    const otherContributionId = uuidv7();
    const systemActor = uuidv7();
    const ownerReviewer = uuidv7();
    const otherReviewer = uuidv7();
    const base = Date.now() - 20_000;
    const ownerDecisionDigest = "3".repeat(64);
    const ownerSourceKeyDigest = "5".repeat(64);
    const ownerSourceReferenceDigest = "6".repeat(64);
    const otherDecisionDigest = "7".repeat(64);
    const otherSourceKeyDigest = "9".repeat(64);
    const otherSourceReferenceDigest = "a".repeat(64);

    await store.open({
      caseId: ownerCaseId,
      contributionId: ownerContributionId,
      contributorUserId: owner,
      systemActorId: systemActor,
      policy: {
        version: "synthetic-trust-rights-v1",
        appealWindowMilliseconds: 14 * 24 * 60 * 60 * 1_000,
      },
      occurredAt: new Date(base),
    });
    await store.review(ownerCaseId, 1, {
      reviewerId: ownerReviewer,
      outcome: "rejected",
      reasonCode: "content_mismatch",
      evidenceDigestSha256: ownerDecisionDigest,
      occurredAt: new Date(base + 1_000),
    });
    await store.recordReputationEvidence({
      id: uuidv7(),
      caseId: ownerCaseId,
      expectedCaseVersion: 2,
      reviewerId: ownerReviewer,
      subject: { kind: "source", sourceKeySha256: ownerSourceKeyDigest },
      signalCode: "source_content_conflict",
      referenceDigestSha256: ownerSourceReferenceDigest,
      occurredAt: new Date(base + 2_001),
    });

    await store.open({
      caseId: otherCaseId,
      contributionId: otherContributionId,
      contributorUserId: otherOwner,
      systemActorId: systemActor,
      policy: {
        version: "synthetic-trust-rights-v1",
        appealWindowMilliseconds: 14 * 24 * 60 * 60 * 1_000,
      },
      occurredAt: new Date(base + 3_000),
    });
    await store.review(otherCaseId, 1, {
      reviewerId: otherReviewer,
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: otherDecisionDigest,
      independentEvidenceDigestSha256: otherDecisionDigest,
      occurredAt: new Date(base + 4_000),
    });
    await store.recordReputationEvidence({
      id: uuidv7(),
      caseId: otherCaseId,
      expectedCaseVersion: 2,
      reviewerId: otherReviewer,
      subject: { kind: "source", sourceKeySha256: otherSourceKeyDigest },
      signalCode: "source_observation_corroborated",
      referenceDigestSha256: otherSourceReferenceDigest,
      occurredAt: new Date(base + 5_001),
    });

    const [result] = await client<{ data: { trust: Record<string, unknown> } }[]>`
      SELECT trust.export_candidate_data(${owner}::uuid) AS data
    `;
    const trust = result?.data.trust;
    expect(Object.keys(result?.data ?? {})).toEqual(["trust"]);
    expect(Object.keys(trust ?? {}).sort()).toEqual(
      ["caseEvents", "cases", "contributorReputationEvidence", "schemaVersion"].sort(),
    );
    expect(trust).toMatchObject({
      schemaVersion: 1,
      cases: [
        {
          id: ownerCaseId,
          contributionId: ownerContributionId,
          policyVersion: "synthetic-trust-rights-v1",
          appealWindowMilliseconds: 14 * 24 * 60 * 60 * 1_000,
          state: "rejected",
          version: 2,
          appealCount: 0,
          adverseState: "rejected",
          lastAction: "review_rejected",
          lastActorKind: "reviewer",
          lastReasonCode: "content_mismatch",
          lastEvidenceDigestSha256: ownerDecisionDigest,
        },
      ],
      caseEvents: [
        {
          eventId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
          caseId: ownerCaseId,
          caseVersion: 1,
          contributionId: ownerContributionId,
          policyVersion: "synthetic-trust-rights-v1",
          resultingState: "needs_review",
          action: "opened",
          actorKind: "system",
          reasonCode: "queued_for_review",
          evidenceDigestSha256: null,
        },
        {
          eventId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
          caseId: ownerCaseId,
          caseVersion: 2,
          contributionId: ownerContributionId,
          policyVersion: "synthetic-trust-rights-v1",
          priorState: "needs_review",
          resultingState: "rejected",
          action: "review_rejected",
          actorKind: "reviewer",
          reasonCode: "content_mismatch",
          evidenceDigestSha256: ownerDecisionDigest,
        },
      ],
      contributorReputationEvidence: [
        {
          caseId: ownerCaseId,
          caseVersion: 2,
          contributionId: ownerContributionId,
          signalCode: "contributor_submission_incorrect",
          referenceDigestSha256: ownerDecisionDigest,
        },
      ],
    });
    const serialized = JSON.stringify(result?.data);
    expect(serialized).not.toContain(ownerReviewer);
    expect(serialized).not.toContain(otherReviewer);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain(otherOwner);
    expect(serialized).not.toContain(otherCaseId);
    expect(serialized).not.toContain(otherContributionId);
    expect(serialized).not.toContain(ownerSourceKeyDigest);
    expect(serialized).not.toContain(ownerSourceReferenceDigest);
    expect(serialized).not.toContain(otherDecisionDigest);
    expect(serialized).not.toContain(otherSourceKeyDigest);
    expect(serialized).not.toContain(otherSourceReferenceDigest);

    const [absent] = await client<{ data: { trust: Record<string, unknown> } }[]>`
      SELECT trust.export_candidate_data(${uuidv7()}::uuid) AS data
    `;
    expect(absent?.data).toEqual({
      trust: {
        schemaVersion: 1,
        cases: [],
        caseEvents: [],
        contributorReputationEvidence: [],
      },
    });

    const [privileges] = await client<
      {
        functionCount: number;
        publicExecuteCount: number;
        securityDefinerCount: number;
      }[]
    >`
      SELECT
        count(*)::int AS "functionCount",
        count(*) FILTER (
          WHERE has_function_privilege(0, procedure.oid, 'EXECUTE')
        )::int AS "publicExecuteCount",
        count(*) FILTER (WHERE procedure.prosecdef)::int AS "securityDefinerCount"
      FROM pg_proc procedure
      WHERE procedure.oid = ANY(ARRAY[
        to_regprocedure('trust.guard_candidate_case_delete()'),
        to_regprocedure('trust.guard_candidate_case_event_delete()'),
        to_regprocedure('trust.guard_candidate_reputation_evidence_delete()'),
        to_regprocedure('trust.export_candidate_data(uuid)'),
        to_regprocedure('trust.delete_candidate_data(uuid,uuid)')
      ])
    `;
    expect(privileges).toEqual({
      functionCount: 5,
      publicExecuteCount: 0,
      securityDefinerCount: 2,
    });

    const ownerAuthorization = await authorizeDeletion(owner);
    const otherAuthorization = await authorizeDeletion(otherOwner);
    try {
      await expect(
        client`DELETE FROM trust.case_events WHERE case_id = ${ownerCaseId}`,
      ).rejects.toThrow("append-only");
      await expect(
        client`DELETE FROM trust.reputation_evidence WHERE case_id = ${ownerCaseId}`,
      ).rejects.toThrow("append-only");
      await expect(
        client`DELETE FROM trust.contribution_cases WHERE id = ${ownerCaseId}`,
      ).rejects.toThrow("cannot be deleted in place");
      await expect(
        client`UPDATE trust.case_events SET reason_code = 'decision_upheld'
          WHERE case_id = ${ownerCaseId} AND case_version = 2`,
      ).rejects.toThrow("append-only");
      await expect(
        client`SELECT trust.delete_candidate_data(${owner}, ${uuidv7()})`,
      ).rejects.toThrow("candidate deletion is not authorized");
      await expect(
        client`SELECT trust.delete_candidate_data(${owner}, ${otherAuthorization.requestId})`,
      ).rejects.toThrow("candidate deletion is not authorized");

      const [deleted] = await client<{ result: Record<string, unknown> }[]>`
        SELECT trust.delete_candidate_data(${owner}, ${ownerAuthorization.requestId}) AS result
      `;
      expect(deleted?.result).toEqual({
        owner: "trust",
        casesDeleted: 1,
        caseEventsDeleted: 2,
        reputationEvidenceDeleted: 2,
      });
      const [replay] = await client<{ result: Record<string, unknown> }[]>`
        SELECT trust.delete_candidate_data(${owner}, ${ownerAuthorization.requestId}) AS result
      `;
      expect(replay?.result).toEqual({
        owner: "trust",
        casesDeleted: 0,
        caseEventsDeleted: 0,
        reputationEvidenceDeleted: 0,
      });

      const [otherCounts] = await client<
        {
          cases: number;
          events: number;
          decisionOutbox: number;
          decisionDeliveries: number;
          contributorEvidence: number;
          sourceEvidence: number;
        }[]
      >`
        SELECT
          (SELECT count(*)::int FROM trust.contribution_cases
            WHERE id = ${otherCaseId} AND contributor_user_id = ${otherOwner}) AS cases,
          (SELECT count(*)::int FROM trust.case_events
            WHERE case_id = ${otherCaseId}) AS events,
          (SELECT count(*)::int FROM trust.contribution_decision_outbox
            WHERE case_id = ${otherCaseId}) AS "decisionOutbox",
          (SELECT count(*)::int FROM trust.contribution_decision_deliveries AS delivery
            JOIN trust.contribution_decision_outbox AS event ON event.id = delivery.event_id
            WHERE event.case_id = ${otherCaseId}) AS "decisionDeliveries",
          (SELECT count(*)::int FROM trust.reputation_evidence
            WHERE case_id = ${otherCaseId} AND subject_kind = 'contributor') AS "contributorEvidence",
          (SELECT count(*)::int FROM trust.reputation_evidence
            WHERE case_id = ${otherCaseId} AND subject_kind = 'source') AS "sourceEvidence"
      `;
      expect(otherCounts).toEqual({
        cases: 1,
        events: 2,
        decisionOutbox: 2,
        decisionDeliveries: 2,
        contributorEvidence: 1,
        sourceEvidence: 1,
      });
    } finally {
      await client`
        SELECT trust.delete_candidate_data(${owner}, ${ownerAuthorization.requestId})
      `;
      await client`
        SELECT trust.delete_candidate_data(${otherOwner}, ${otherAuthorization.requestId})
      `;
      await removeAuthorization(owner, ownerAuthorization);
      await removeAuthorization(otherOwner, otherAuthorization);
    }
  });

  it("validates actual accepted/reversed SQL exports against the shared portable export schema", async () => {
    const owner = uuidv7();
    const caseId = uuidv7();
    const contributionId = uuidv7();
    const reviewer = uuidv7();
    const base = Date.now() - 30_000;
    await store.open({
      caseId,
      contributionId,
      contributorUserId: owner,
      systemActorId: uuidv7(),
      policy: { version: "synthetic-export-basis-v1", appealWindowMilliseconds: 86_400_000 },
      occurredAt: new Date(base),
    });
    await store.review(caseId, 1, {
      reviewerId: reviewer,
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: "a".repeat(64),
      independentEvidenceDigestSha256: "a".repeat(64),
      occurredAt: new Date(base + 1_000),
    });
    await store.takeDown(caseId, 2, {
      reviewerId: reviewer,
      reasonCode: "credible_safety_risk",
      evidenceDigestSha256: "b".repeat(64),
      occurredAt: new Date(base + 2_000),
    });
    await store.appeal(caseId, 3, {
      contributorUserId: owner,
      evidenceDigestSha256: "c".repeat(64),
      occurredAt: new Date(base + 3_000),
    });
    await store.resolveAppeal(caseId, 4, {
      reviewerId: uuidv7(),
      outcome: "reversed",
      evidenceDigestSha256: "d".repeat(64),
      independentEvidenceDigestSha256: "e".repeat(64),
      occurredAt: new Date(base + 4_000),
    });
    const [result] = await client<
      {
        data: {
          trust: {
            cases: Record<string, unknown>[];
            caseEvents: Record<string, unknown>[];
            contributorReputationEvidence: Record<string, unknown>[];
          };
        };
      }[]
    >`
      SELECT trust.export_candidate_data(${owner}::uuid) AS data
    `;
    if (!result) throw new Error("Expected synthetic SQL export");
    const trust = result.data.trust;
    const generatedAt = new Date().toISOString();
    const exported = {
      schemaVersion: 1,
      format: "candidate-data-export-v1",
      exportId: uuidv7(),
      policyVersion: "synthetic-export-v1",
      generatedAt,
      candidate: { email: "synthetic@example.test", createdAt: generatedAt, connectedAccounts: [] },
      profile: { preferences: null, facts: [] },
      documents: { resumes: [] },
      jobs: { reports: [] },
      matching: { savedJobs: [] },
      billing: { entitlement: { plan: "free", version: 0, effectiveAt: generatedAt } },
      trust,
      audit: { events: [] },
    };
    expect(validateCandidateDataExportV1(exported)).toBe(true);
    expect(trust.cases).toEqual([
      expect.objectContaining({
        lastEvidenceDigestSha256: "d".repeat(64),
        independentEvidenceDigestSha256: "e".repeat(64),
      }),
    ]);
    expect(
      trust.caseEvents.map((event) => ({
        basis: event.independentEvidenceDigestSha256,
        evidence: event.evidenceDigestSha256,
      })),
    ).toEqual([
      { basis: null, evidence: null },
      { basis: "a".repeat(64), evidence: "a".repeat(64) },
      { basis: "a".repeat(64), evidence: "b".repeat(64) },
      { basis: "a".repeat(64), evidence: "c".repeat(64) },
      { basis: "e".repeat(64), evidence: "d".repeat(64) },
    ]);
    for (const row of trust.caseEvents) expect(row.eventId).toMatch(/^[a-f0-9-]{36}$/);
    const removeAdditive = (row: Record<string, unknown>) => {
      const { independentEvidenceDigestSha256: _basis, eventId: _event, ...old } = row;
      return old;
    };
    expect(
      validateCandidateDataExportV1({
        ...exported,
        trust: {
          ...trust,
          cases: trust.cases.map(removeAdditive),
          caseEvents: trust.caseEvents.map(removeAdditive),
        },
      }),
    ).toBe(true);
    for (const extra of [
      { reviewerId: reviewer },
      { unexpected: true },
      { independentEvidenceDigestSha256: "invalid" },
    ]) {
      expect(
        validateCandidateDataExportV1({
          ...exported,
          trust: { ...trust, cases: trust.cases.map((row) => ({ ...row, ...extra })) },
        }),
      ).toBe(false);
      expect(
        validateCandidateDataExportV1({
          ...exported,
          trust: { ...trust, caseEvents: trust.caseEvents.map((row) => ({ ...row, ...extra })) },
        }),
      ).toBe(false);
    }
    const authorization = await authorizeDeletion(owner);
    try {
      await client`SELECT trust.delete_candidate_data(${owner}, ${authorization.requestId})`;
      const [absent] = await client<{ count: number }[]>`SELECT count(*)::int AS count
        FROM trust.case_events WHERE case_id=${caseId}`;
      expect(absent?.count).toBe(0);
    } finally {
      await removeAuthorization(owner, authorization);
    }
  });
});
