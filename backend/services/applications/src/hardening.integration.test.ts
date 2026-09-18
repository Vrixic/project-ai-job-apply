import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationsService } from "./service.js";
import { allowedStatusPairs, applicationStatuses } from "./state-machine.js";
import { PostgresApplicationStore } from "./store.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");

describeWithDatabase("D3-011 Applications hardening over PostgreSQL", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 10,
    onnotice: () => undefined,
  });
  const secret = "very-private-candidate-value@example.test";
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

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function approvedApplication() {
    const owner = uuidv7();
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
    return { owner, applicationId: created.id, approved };
  }

  it("keeps the database status guard identical to the domain lifecycle", async () => {
    const allowed = new Set(allowedStatusPairs().map(([from, to]) => `${from}>${to}`));
    const observed = new Set<string>();
    for (const from of applicationStatuses) {
      for (const to of applicationStatuses) {
        if (from === to) continue;
        const id = uuidv7();
        await client`
          INSERT INTO applications.applications
            (id, owner_user_id, canonical_job_id, status, revision, created_at, updated_at)
          VALUES (${id}, ${uuidv7()}, ${uuidv7()}, ${from}, 1, now(), now())
        `;
        try {
          await client`
            UPDATE applications.applications SET status = ${to}, revision = 2, updated_at = now()
            WHERE id = ${id}
          `;
          observed.add(`${from}>${to}`);
        } catch {
          // Refused by the guard, as expected for a pair outside the lifecycle.
        }
      }
    }
    expect([...observed].sort()).toEqual([...allowed].sort());
  });

  it("never lets another owner's ids reach a mutation or a read", async () => {
    const { owner, applicationId, approved } = await approvedApplication();
    const stranger = uuidv7();
    await expect(service.get(stranger, applicationId)).rejects.toMatchObject({
      name: "ApplicationNotFoundError",
    });
    await expect(
      service.cancel(stranger, applicationId, approved.revision, key("cancel")),
    ).rejects.toMatchObject({ name: "ApplicationNotFoundError" });
    await expect(
      service.startSubmission(
        stranger,
        applicationId,
        {
          expectedRevision: approved.revision,
          adapterId: "greenhouse",
          adapterVersion: "1.0.0",
          observedFormHash: HASH_B,
        },
        key("start"),
      ),
    ).rejects.toMatchObject({ name: "ApplicationNotFoundError" });
    expect((await service.get(owner, applicationId)).status).toBe("approved");
  });

  it("allows exactly one submission when many concurrent starts race", async () => {
    const { owner, applicationId, approved } = await approvedApplication();
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        service.startSubmission(
          owner,
          applicationId,
          {
            expectedRevision: approved.revision,
            adapterId: "greenhouse",
            adapterVersion: "1.0.0",
            observedFormHash: HASH_B,
          },
          key(`race-${index}`),
        ),
      ),
    );
    const started = attempts.filter(
      (result) => result.status === "fulfilled" && result.value.outcome === "started",
    );
    expect(started).toHaveLength(1);
    const rows = await client`
      SELECT id FROM applications.attempts WHERE application_id = ${applicationId}
    `;
    expect(rows).toHaveLength(1);
  });

  it("does not leak candidate values into history, outbox, receipts, or problem messages", async () => {
    const { owner, applicationId, approved } = await approvedApplication();
    const start = await service.startSubmission(
      owner,
      applicationId,
      {
        expectedRevision: approved.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: HASH_B,
      },
      key("start"),
    );
    await service.dispatchAttempt(owner, applicationId, start.attemptId ?? "");
    await service.recordResult(
      owner,
      applicationId,
      start.attemptId ?? "",
      { kind: "timeout" },
      key("timeout"),
    );
    const captured: string[] = [];
    for (const table of ["history", "outbox", "command_receipts"] as const) {
      const rows = await client.unsafe(
        `SELECT * FROM applications.${table} WHERE application_id = $1`,
        [applicationId],
      );
      captured.push(JSON.stringify(rows));
    }
    const failure = await service
      .startSubmission(
        owner,
        applicationId,
        {
          expectedRevision: 999,
          adapterId: "greenhouse",
          adapterVersion: "1.0.0",
          observedFormHash: HASH_B,
        },
        key("stale"),
      )
      .catch((error: Error) => error.message);
    captured.push(String(failure));
    for (const text of captured) expect(text).not.toContain(secret);
    // The packet itself is the only place the value lives, and only for its owner.
    expect(JSON.stringify(await service.get(owner, applicationId))).toContain(secret);
    expect(JSON.stringify(await service.history(owner, applicationId, {}))).not.toContain(secret);
  });

  it("recovers from a crash between dispatch and result without a second submission", async () => {
    const { owner, applicationId, approved } = await approvedApplication();
    const start = await service.startSubmission(
      owner,
      applicationId,
      {
        expectedRevision: approved.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: HASH_B,
      },
      key("start"),
    );
    await service.dispatchAttempt(owner, applicationId, start.attemptId ?? "");
    // The worker dies here. Recovery marks it ambiguous; nothing can dispatch again.
    const store = new PostgresApplicationStore(client, () => new Date(Date.now() + 3_600_000), {
      definitions,
    });
    await store.recoverStaleAttempts(60_000, 500);
    const recovered = await service.get(owner, applicationId);
    expect(recovered.status).toBe("reconciliation_required");
    await expect(
      service.dispatchAttempt(owner, applicationId, start.attemptId ?? ""),
    ).rejects.toMatchObject({
      name: "AttemptRefusedError",
    });
    await expect(
      service.startSubmission(
        owner,
        applicationId,
        {
          expectedRevision: recovered.revision,
          adapterId: "greenhouse",
          adapterVersion: "1.0.0",
          observedFormHash: HASH_B,
        },
        key("again"),
      ),
    ).rejects.toMatchObject({ code: "NOT_APPROVED" });
    const rows = await client`
      SELECT status FROM applications.attempts WHERE application_id = ${applicationId}
    `;
    expect(rows.map((row) => row.status)).toEqual(["ambiguous"]);
  });
});
