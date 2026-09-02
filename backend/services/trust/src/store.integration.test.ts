import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  const owner = uuidv7();
  const otherOwner = uuidv7();
  const systemActor = uuidv7();
  const firstReviewer = uuidv7();
  const appealReviewer = uuidv7();
  const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));

  beforeAll(async () => {
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(first.stdout.trim()).toBe(
      "Trust migrations through 0002_candidate_rights applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(first.stdout.trim());
    await store.ping();
  });

  afterAll(async () => {
    await client.end();
  });

  it("persists an owner-private, independently reviewed, immutable one-appeal lifecycle", async () => {
    const caseId = uuidv7();
    const contributionId = uuidv7();
    const base = Date.now() - 10_000;
    const opened = await store.open({
      caseId,
      contributionId,
      contributorUserId: owner,
      systemActorId: systemActor,
      policy: {
        version: "synthetic-appeal-policy-v1",
        appealWindowMilliseconds: 14 * 24 * 60 * 60 * 1_000,
      },
      occurredAt: new Date(base),
    });
    expect(opened.state).toBe("needs_review");
    expect(await store.readOwnerCase(owner, caseId)).toMatchObject({ state: "needs_review" });
    expect(await store.readOwnerCase(otherOwner, caseId)).toBeNull();

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
      subject: { kind: "contributor" },
      signalCode: "contributor_submission_incorrect",
      referenceDigestSha256: "b".repeat(64),
      occurredAt: new Date(base + 2_000),
    });
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
      { events: string; contributorSignals: string; sourceSignals: string }[]
    >`
      SELECT
        (SELECT count(*)::text FROM trust.case_events WHERE case_id = ${caseId}) AS events,
        (SELECT count(*)::text FROM trust.reputation_evidence
          WHERE case_id = ${caseId} AND subject_kind = 'contributor') AS "contributorSignals",
        (SELECT count(*)::text FROM trust.reputation_evidence
          WHERE case_id = ${caseId} AND subject_kind = 'source') AS "sourceSignals"
    `;
    expect(counts).toEqual({ events: "4", contributorSignals: "1", sourceSignals: "1" });

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
});
