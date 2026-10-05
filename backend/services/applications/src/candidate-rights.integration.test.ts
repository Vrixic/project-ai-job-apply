import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateCandidateDataExportV1 } from "@ai-job-apply/domain";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationsService } from "./service.js";
import { PostgresApplicationStore } from "./store.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");

interface CandidateDeletionAuthorization {
  operationId: string;
  requestId: string;
}

type OwnerExport = {
  applications: {
    schemaVersion: number;
    applications: Array<{ id: string; status: string }>;
    packets: Array<{ id: string; fields: Array<{ value: unknown }> }>;
    approvals: unknown[];
    attempts: Array<{ status: string }>;
    history: Array<{ kind: string }>;
  };
  audit: { events: Array<{ owner: string; action: string }> };
};

describeWithDatabase("D3-014 Applications candidate rights ownership", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  const secret = "synthetic-private-answer@example.test";
  const service = new ApplicationsService({
    store: new PostgresApplicationStore(client, () => new Date(), { definitions }),
    packets: {
      async prepare() {
        return {
          jobRevision: HASH_A,
          form: { adapterId: "greenhouse", variantId: "board-v1", formHash: HASH_B },
          fields: [proposal({ value: secret })],
          artifactHashes: { resume: HASH_C },
        };
      },
    },
    bindings: {
      async resolve({ formHash }) {
        return { jobRevision: HASH_A, formHash, resumeHash: HASH_C };
      },
    },
    jobs: { isActive: async () => true },
  });
  const tables = [
    "outbox",
    "command_receipts",
    "history",
    "attempts",
    "approvals",
    "packets",
    "applications",
  ] as const;

  beforeAll(async () => {
    // Rights assertions require Profile authorization, not Turbo package execution order.
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    const profile = await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env },
    );
    expect(profile.stdout.trim()).toContain("applied and verified.");
    const executable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const first = await execFileAsync(process.execPath, [executable], { env });
    const replay = await execFileAsync(process.execPath, [executable], { env });
    const expected =
      "Applications migrations through 0006_vault_approval_binding applied and verified.";
    expect(first.stdout.trim()).toBe(expected);
    expect(replay.stdout.trim()).toBe(expected);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function appliedApplication(owner: string) {
    const created = await service.create(owner, uuidv7(), key("create"));
    const prepared = await service.preparePacket(
      owner,
      created.id,
      { expectedRevision: created.revision },
      key("packet"),
    );
    const approved = await service.approve(
      owner,
      created.id,
      {
        expectedRevision: prepared.revision,
        packetHash: prepared.currentPacket?.packetHash ?? "",
        acknowledgedFieldKeys: [],
      },
      key("approve"),
    );
    const start = await service.startSubmission(
      owner,
      created.id,
      {
        expectedRevision: approved.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: HASH_B,
      },
      key("start"),
    );
    await service.dispatchAttempt(owner, created.id, start.attemptId ?? "");
    await service.recordResult(
      owner,
      created.id,
      start.attemptId ?? "",
      {
        kind: "confirmed",
        confirmation: {
          kind: "provider_confirmation_page",
          observedAt: new Date().toISOString(),
          fingerprintSha256: HASH_A,
          providerReference: "confirmation-123",
        },
      },
      key("result"),
    );
    return created.id;
  }

  async function exportFor(owner: string): Promise<OwnerExport> {
    const [row] = await client<{ data: OwnerExport }[]>`
      SELECT applications.export_candidate_data(${owner}::uuid) AS data
    `;
    if (!row) throw new Error("export returned no row");
    return row.data;
  }

  async function count(table: string, owner: string): Promise<number> {
    const [row] = await client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM ${client(`applications.${table}`)}
      WHERE owner_user_id = ${owner}
    `;
    return row?.total ?? 0;
  }

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
        ${requestId}, ${userId}, ${operationId}, 'synthetic-applications-rights-v1',
        'quarantined', 2, ${confirmedAt}, ${confirmedAt}, ${confirmedAt}, ${backupExpiresAt}
      )
    `;
    await client`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at
      ) VALUES (
        ${requestId}, ${"1".repeat(64)}, 'synthetic-applications-rights-v1', ${"2".repeat(64)},
        'quarantined', ${client.json({ applications: "pending" })}, ${client.json({})},
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

  it("exports only the exact candidate's own Applications data and no internal keys", async () => {
    const owner = uuidv7();
    const other = uuidv7();
    const applicationId = await appliedApplication(owner);
    await appliedApplication(other);

    const exported = await exportFor(owner);
    const section = exported.applications;
    expect(section.schemaVersion).toBe(1);
    expect(section.applications.map((entry) => entry.id)).toEqual([applicationId]);
    expect(section.applications[0]?.status).toBe("applied");
    expect(section.packets).toHaveLength(1);
    expect(section.packets[0]?.fields[0]?.value).toBe(secret);
    expect(section.approvals).toHaveLength(1);
    expect(section.attempts.map((attempt) => attempt.status)).toEqual(["confirmed"]);
    expect(section.history.at(-1)?.kind).toBe("submission_confirmed");
    expect(exported.audit.events).toHaveLength(section.history.length);
    expect(new Set(exported.audit.events.map((event) => event.owner))).toEqual(
      new Set(["applications"]),
    );

    // Internal-only values never leave the owner boundary.
    const [internal] = await client<{ scopeKey: string; consentId: string; fingerprint: string }[]>`
      SELECT attempt.scope_key AS "scopeKey", approval.consent_id::text AS "consentId",
             attempt.evidence_fingerprint AS fingerprint
      FROM applications.attempts attempt
      JOIN applications.approvals approval ON approval.id = attempt.approval_id
      WHERE attempt.owner_user_id = ${owner}
    `;
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(internal?.scopeKey ?? "missing");
    expect(serialized).not.toContain(internal?.consentId ?? "missing");
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain(other);
    expect(serialized).not.toMatch(/interview|offer|recruiter|hired|rejected/i);
    expect(serialized).not.toContain("scope_key");
    expect(serialized).not.toContain("owner_user_id");

    const envelope = {
      schemaVersion: 1,
      format: "candidate-data-export-v1",
      exportId: uuidv7(),
      policyVersion: "d3-development-synthetic-v1",
      generatedAt: new Date().toISOString(),
      candidate: {
        email: "candidate@example.test",
        createdAt: new Date().toISOString(),
        connectedAccounts: [],
      },
      profile: { preferences: null, facts: [] },
      documents: { resumes: [] },
      jobs: { reports: [] },
      matching: { savedJobs: [] },
      billing: {
        entitlement: { plan: "free", version: 0, effectiveAt: new Date().toISOString() },
      },
      applications: section,
      audit: { events: exported.audit.events },
    };
    expect(validateCandidateDataExportV1(envelope)).toBe(true);

    const empty = await exportFor(uuidv7());
    expect(empty.applications).toMatchObject({
      schemaVersion: 1,
      applications: [],
      packets: [],
      approvals: [],
      attempts: [],
      history: [],
    });
    expect(empty.audit.events).toEqual([]);
    expect(validateCandidateDataExportV1({ ...envelope, applications: empty.applications })).toBe(
      true,
    );
  });

  it("keeps every table append-only and refuses deletion without exact authorization", async () => {
    const owner = uuidv7();
    await appliedApplication(owner);
    for (const table of tables) {
      await expect(
        client`DELETE FROM ${client(`applications.${table}`)} WHERE owner_user_id = ${owner}`,
      ).rejects.toThrow(/append-only/);
    }
    await expect(
      client`UPDATE applications.history SET reason_code = 'edited' WHERE owner_user_id = ${owner}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      client`SELECT applications.delete_candidate_data(${owner}::uuid, ${uuidv7()}::uuid)`,
    ).rejects.toThrow(/not authorized/);
    for (const table of tables) {
      expect(await count(table, owner)).toBeGreaterThan(0);
    }
  });

  it("deletes exactly the authorized candidate, children before parents, and replays safely", async () => {
    const doomed = uuidv7();
    const survivor = uuidv7();
    await appliedApplication(doomed);
    await appliedApplication(doomed);
    const survivorApplication = await appliedApplication(survivor);
    const survivorBefore = await exportFor(survivor);

    const authorization = await authorizeDeletion(doomed);
    try {
      // Another candidate's request never authorizes this candidate's data.
      await expect(
        client`SELECT applications.delete_candidate_data(${survivor}::uuid, ${authorization.requestId}::uuid)`,
      ).rejects.toThrow(/not authorized/);
      expect(await count("applications", survivor)).toBe(1);

      const [result] = await client<{ result: Record<string, unknown> }[]>`
        SELECT applications.delete_candidate_data(${doomed}::uuid, ${authorization.requestId}::uuid) AS result
      `;
      expect(result?.result).toEqual({
        owner: "applications",
        applicationsDeleted: 2,
        packetsDeleted: 2,
        attemptsDeleted: 2,
      });
      for (const table of tables) {
        expect(await count(table, doomed), table).toBe(0);
      }
      expect((await exportFor(doomed)).applications.applications).toEqual([]);

      // The survivor is untouched, byte for byte.
      expect(await exportFor(survivor)).toEqual(survivorBefore);
      expect((await service.get(survivor, survivorApplication)).status).toBe("applied");

      const [replay] = await client<{ result: Record<string, unknown> }[]>`
        SELECT applications.delete_candidate_data(${doomed}::uuid, ${authorization.requestId}::uuid) AS result
      `;
      expect(replay?.result).toEqual({
        owner: "applications",
        applicationsDeleted: 0,
        packetsDeleted: 0,
        attemptsDeleted: 0,
      });
    } finally {
      await removeAuthorization(doomed, authorization);
    }
    // Once the authorization is gone the tables are append-only again.
    await expect(
      client`DELETE FROM applications.applications WHERE owner_user_id = ${survivor}`,
    ).rejects.toThrow(/append-only/);
  });
});
