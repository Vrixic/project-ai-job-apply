import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTrustDecisionSignalStore } from "./decision-signal-store.js";
import { PostgresTrustStore, TrustVersionConflictError } from "./store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgreSQL UGC trust foundation", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const store = new PostgresTrustStore(client);
  const signals = new PostgresTrustDecisionSignalStore(client);
  const owner = uuidv7();
  const otherOwner = uuidv7();
  const systemActor = uuidv7();
  const firstReviewer = uuidv7();
  const appealReviewer = uuidv7();
  const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
  const profileMigrationExecutable = fileURLToPath(
    new URL("../../profile/dist/src/migrate.js", import.meta.url),
  );

  beforeAll(async () => {
    // Deletion guards use the Profile-owned privacy boundary, regardless of suite order.
    const profile = await execFileAsync(process.execPath, [profileMigrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(profile.stdout.trim()).toBe(
      "Database migrations through 0009_ugc_contribution_consent_candidate_rights applied and verified.",
    );
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(first.stdout.trim()).toBe(
      "Trust migrations through 0003_decision_signals applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(first.stdout.trim());
    await store.ping();
  });

  afterAll(async () => {
    await client.end();
  });

  it("pages the fixed review queue with a stable keyset and no unrelated case states", async () => {
    const at = new Date("2020-01-01T00:00:00.000Z");
    const ids = [uuidv7(), uuidv7(), uuidv7()].sort();
    const firstId = ids[0];
    if (!firstId) throw new Error("Expected a synthetic queue case");
    for (const caseId of ids)
      await store.open({
        caseId,
        contributionId: uuidv7(),
        contributorUserId: owner,
        systemActorId: systemActor,
        policy: { version: "synthetic-review-queue-v1", appealWindowMilliseconds: 1_000 },
        occurredAt: at,
      });
    const first = await store.listReviewerCases({ state: "needs_review", pageSize: 1 });
    expect(first).toHaveLength(2); // One bounded lookahead row.
    expect(first.map((item) => item.id)).toEqual(ids.slice(0, 2));
    const next = await store.listReviewerCases({
      state: "needs_review",
      pageSize: 1,
      after: { updatedAt: at.toISOString(), id: firstId },
    });
    expect(next.map((item) => item.id)).toEqual(ids.slice(1));
    expect(await store.listReviewerCases({ state: "appeal_pending", pageSize: 25 })).toEqual([]);
    await expect(
      store.listReviewerCases({ state: "needs_review", pageSize: 26 }),
    ).rejects.toThrow();
  });

  it("persists an owner-private, independently reviewed, immutable one-appeal lifecycle", async () => {
    const caseId = uuidv7();
    const contributionId = uuidv7();
    const base = Date.now() - 10_000;
    const openInput = {
      caseId,
      contributionId,
      contributorUserId: owner,
      systemActorId: systemActor,
      policy: {
        version: "synthetic-appeal-policy-v1",
        appealWindowMilliseconds: 14 * 24 * 60 * 60 * 1_000,
      },
      occurredAt: new Date(base),
    };
    const opened = await store.open(openInput);
    const ambiguousRetry = await store.open(openInput);
    expect(opened.state).toBe("needs_review");
    expect(ambiguousRetry).toEqual(opened);
    expect(await store.readOwnerCase(owner, caseId)).toMatchObject({ state: "needs_review" });
    expect(await store.readOwnerCase(otherOwner, caseId)).toBeNull();
    expect(await store.readOwnerCaseByContribution(owner, contributionId)).toMatchObject({
      id: caseId,
      state: "needs_review",
    });
    expect(await store.readOwnerCaseByContribution(otherOwner, contributionId)).toBeNull();
    const [openEventCount] = await client<{ count: string }[]>`
      SELECT count(*)::text AS count FROM trust.case_events WHERE case_id = ${caseId}
    `;
    expect(openEventCount?.count).toBe("1");
    const [openedSignal] = await client<{ decisionId: string }[]>`
      SELECT event_id AS "decisionId" FROM trust.case_events
      WHERE case_id = ${caseId} AND case_version = 1
    `;
    expect(openedSignal?.decisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    if (!openedSignal) throw new Error("Expected the deterministic open decision signal");
    expect(await signals.readSignal(openedSignal.decisionId)).toEqual({
      decisionId: openedSignal.decisionId,
      contributionId,
    });
    expect(
      await signals.readDecision({
        decisionId: openedSignal.decisionId,
        contributionId,
        contributorUserId: owner,
      }),
    ).toMatchObject({ status: "needs_review", contributionId });
    expect(
      await signals.readDecision({
        decisionId: openedSignal.decisionId,
        contributionId,
        contributorUserId: otherOwner,
      }),
    ).toBeNull();

    const rejected = await store.review(caseId, 1, {
      reviewerId: firstReviewer,
      outcome: "rejected",
      reasonCode: "content_mismatch",
      evidenceDigestSha256: "a".repeat(64),
      occurredAt: new Date(base + 1_000),
    });
    expect(rejected.state).toBe("rejected");

    await store.recordReputationEvidence({
      id: uuidv7(),
      caseId,
      expectedCaseVersion: 2,
      reviewerId: firstReviewer,
      subject: { kind: "source", sourceKeySha256: "c".repeat(64) },
      signalCode: "source_content_conflict",
      referenceDigestSha256: "d".repeat(64),
      occurredAt: new Date(base + 2_001),
    });
    expect(await store.readOwnerReputationEvidence(owner, caseId)).toEqual([
      expect.objectContaining({
        contributionId,
        signalCode: "contributor_submission_incorrect",
        occurredAt: new Date(base + 1_000).toISOString(),
      }),
    ]);
    expect(await store.readOwnerReputationEvidence(otherOwner, caseId)).toEqual([]);

    const appealed = await store.appeal(caseId, 2, {
      contributorUserId: owner,
      evidenceDigestSha256: "e".repeat(64),
      occurredAt: new Date(base + 3_000),
    });
    expect(appealed).toMatchObject({ state: "appeal_pending", appealCount: 1, version: 3 });

    await expect(
      client`
        UPDATE trust.contribution_cases SET state = 'accepted', version = 4,
          pending_appeal_evidence_digest_sha256 = null,
          last_action = 'appeal_reversed', last_actor_kind = 'reviewer',
          last_actor_id = ${firstReviewer}, last_reason_code = 'decision_reversed',
          last_evidence_digest_sha256 = ${"f".repeat(64)}, updated_at = ${new Date(base + 4_000)}
        WHERE id = ${caseId}
      `,
    ).rejects.toThrow("appeal decision is invalid");

    const reversed = await store.resolveAppeal(caseId, 3, {
      reviewerId: appealReviewer,
      outcome: "reversed",
      evidenceDigestSha256: "f".repeat(64),
      occurredAt: new Date(base + 4_000),
    });
    expect(reversed).toMatchObject({ state: "accepted", appealCount: 1, version: 4 });
    expect(await store.readOwnerReputationEvidence(owner, caseId)).toEqual([
      expect.objectContaining({ signalCode: "contributor_submission_incorrect" }),
      expect.objectContaining({ signalCode: "adverse_decision_reversed" }),
    ]);
    expect(
      await signals.readLatestDecision({ contributionId, contributorUserId: owner }),
    ).toMatchObject({ status: "accepted", contributionId });
    expect(
      await signals.readLatestDecision({ contributionId, contributorUserId: otherOwner }),
    ).toBeNull();
    await expect(
      store.appeal(caseId, 4, {
        contributorUserId: owner,
        evidenceDigestSha256: "0".repeat(64),
        occurredAt: new Date(base + 5_000),
      }),
    ).rejects.toThrow("Only one appeal");
    await expect(
      store.review(caseId, 3, {
        reviewerId: appealReviewer,
        outcome: "accepted",
        reasonCode: "independently_verified",
        evidenceDigestSha256: "0".repeat(64),
        occurredAt: new Date(base + 5_000),
      }),
    ).rejects.toBeInstanceOf(TrustVersionConflictError);

    const [counts] = await client<
      {
        events: string;
        decisionOutbox: string;
        decisionDeliveries: string;
        contributorSignals: string;
        sourceSignals: string;
      }[]
    >`
      SELECT
        (SELECT count(*)::text FROM trust.case_events WHERE case_id = ${caseId}) AS events,
        (SELECT count(*)::text FROM trust.contribution_decision_outbox
          WHERE case_id = ${caseId}) AS "decisionOutbox",
        (SELECT count(*)::text FROM trust.contribution_decision_deliveries AS delivery
          JOIN trust.contribution_decision_outbox AS event ON event.id = delivery.event_id
          WHERE event.case_id = ${caseId}) AS "decisionDeliveries",
        (SELECT count(*)::text FROM trust.reputation_evidence
          WHERE case_id = ${caseId} AND subject_kind = 'contributor') AS "contributorSignals",
        (SELECT count(*)::text FROM trust.reputation_evidence
          WHERE case_id = ${caseId} AND subject_kind = 'source') AS "sourceSignals"
    `;
    expect(counts).toEqual({
      events: "4",
      decisionOutbox: "4",
      decisionDeliveries: "4",
      contributorSignals: "2",
      sourceSignals: "1",
    });

    await expect(
      client`UPDATE trust.contribution_decision_outbox SET event_type = event_type
        WHERE case_id = ${caseId}`,
    ).rejects.toThrow("append-only");
    await expect(
      client`DELETE FROM trust.contribution_decision_deliveries
        WHERE event_id = ${openedSignal.decisionId}`,
    ).rejects.toThrow("candidate deletion authority");

    await expect(
      client`UPDATE trust.case_events SET reason_code = 'decision_upheld'
        WHERE case_id = ${caseId} AND case_version = 2`,
    ).rejects.toThrow("append-only");
    await expect(
      client`UPDATE trust.reputation_evidence SET signal_code = 'contributor_submission_verified'
        WHERE case_id = ${caseId} AND subject_kind = 'contributor'`,
    ).rejects.toThrow("append-only");

    const dependencies = await client<{ forbiddenCount: number }[]>`
      SELECT count(*)::int AS "forbiddenCount"
      FROM pg_depend dependency
      INNER JOIN pg_class dependent ON dependent.oid = dependency.objid
      INNER JOIN pg_namespace dependent_namespace ON dependent_namespace.oid = dependent.relnamespace
      INNER JOIN pg_class referenced ON referenced.oid = dependency.refobjid
      INNER JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced.relnamespace
      WHERE dependent_namespace.nspname = 'trust' AND referenced_namespace.nspname = 'jobs'
    `;
    expect(dependencies[0]?.forbiddenCount).toBe(0);
  });

  it("records only semantically justified contributor reputation in the transition transaction", async () => {
    const base = Date.now() - 10_000;
    const acceptedCaseId = uuidv7();
    const acceptedContributionId = uuidv7();
    await store.open({
      caseId: acceptedCaseId,
      contributionId: acceptedContributionId,
      contributorUserId: owner,
      systemActorId: systemActor,
      policy: { version: "synthetic-reputation-v1", appealWindowMilliseconds: 86_400_000 },
      occurredAt: new Date(base),
    });
    await store.review(acceptedCaseId, 1, {
      reviewerId: firstReviewer,
      outcome: "accepted",
      reasonCode: "independently_verified",
      evidenceDigestSha256: "1".repeat(64),
      occurredAt: new Date(base + 1_000),
    });
    await store.takeDown(acceptedCaseId, 2, {
      reviewerId: firstReviewer,
      reasonCode: "verified_requester_takedown",
      evidenceDigestSha256: "2".repeat(64),
      occurredAt: new Date(base + 2_000),
    });

    const deceptiveCaseId = uuidv7();
    await store.open({
      caseId: deceptiveCaseId,
      contributionId: uuidv7(),
      contributorUserId: owner,
      systemActorId: systemActor,
      policy: { version: "synthetic-reputation-v1", appealWindowMilliseconds: 86_400_000 },
      occurredAt: new Date(base + 3_000),
    });
    await store.review(deceptiveCaseId, 1, {
      reviewerId: firstReviewer,
      outcome: "rejected",
      reasonCode: "malicious_or_deceptive",
      evidenceDigestSha256: "3".repeat(64),
      occurredAt: new Date(base + 4_000),
    });

    const policyCaseId = uuidv7();
    await store.open({
      caseId: policyCaseId,
      contributionId: uuidv7(),
      contributorUserId: owner,
      systemActorId: systemActor,
      policy: { version: "synthetic-reputation-v1", appealWindowMilliseconds: 86_400_000 },
      occurredAt: new Date(base + 5_000),
    });
    await store.review(policyCaseId, 1, {
      reviewerId: firstReviewer,
      outcome: "rejected",
      reasonCode: "license_or_policy_block",
      evidenceDigestSha256: "4".repeat(64),
      occurredAt: new Date(base + 6_000),
    });

    const rows = await client<
      { caseId: string; signalCode: string; referenceDigestSha256: string }[]
    >`
      SELECT case_id AS "caseId", signal_code AS "signalCode",
        reference_digest_sha256 AS "referenceDigestSha256"
      FROM trust.reputation_evidence
      WHERE case_id IN (${acceptedCaseId}, ${deceptiveCaseId}, ${policyCaseId})
      ORDER BY case_id, signal_code
    `;
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          caseId: acceptedCaseId,
          signalCode: "contributor_submission_verified",
          referenceDigestSha256: "1".repeat(64),
        },
        {
          caseId: deceptiveCaseId,
          signalCode: "contributor_abuse_detected",
          referenceDigestSha256: "3".repeat(64),
        },
      ]),
    );
    expect(rows).toHaveLength(2);
  });
});
