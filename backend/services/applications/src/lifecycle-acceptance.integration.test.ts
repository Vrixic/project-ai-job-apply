import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApplicationsAcceptanceInput,
  applicationsAcceptanceSubject,
  executeApplicationsAcceptance,
} from "./lifecycle-acceptance.js";
import { ApplicationsService } from "./service.js";
import { PostgresApplicationStore } from "./store.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");
const ISSUER = "https://generated-acceptance.invalid/";

describeWithDatabase("Applications lifecycle acceptance fixture over PostgreSQL", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  const service = new ApplicationsService({
    store: new PostgresApplicationStore(client, () => new Date(), { definitions }),
    packets: {
      async prepare() {
        return {
          jobRevision: HASH_A,
          form: { adapterId: "synthetic-acceptance", variantId: "v1", formHash: HASH_B },
          fields: [proposal({ value: "generated-value@example.test" })],
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
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env },
    );
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url))],
      { env },
    );
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  function input(
    action: "prepare" | "cleanup",
    overrides: Partial<ApplicationsAcceptanceInput> = {},
  ): ApplicationsAcceptanceInput {
    const base = {
      action,
      runId: uuidv4(),
      issuer: ISSUER,
      ownerUserId: uuidv7(),
      otherUserId: uuidv7(),
    };
    return {
      ...base,
      ...(action === "prepare" ? { at: new Date() } : {}),
      ...overrides,
    };
  }

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
        adapterId: "synthetic-acceptance",
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
      { kind: "timeout" },
      key("result"),
    );
    // The candidate attests the submission; no provider confirmation is ever claimed.
    await service.reconcile(
      owner,
      created.id,
      start.attemptId ?? "",
      {
        kind: "user_attested_submitted",
        observedAt: new Date().toISOString(),
        fingerprintSha256: HASH_A,
      },
      key("reconcile"),
    );
    return created.id;
  }

  async function presence(fixture: ApplicationsAcceptanceInput) {
    const [row] = await client<{ users: number; identities: number; applications: number }[]>`
      SELECT
        (SELECT count(*)::int FROM identity.users
          WHERE id IN (${fixture.ownerUserId}, ${fixture.otherUserId})) AS users,
        (SELECT count(*)::int FROM identity.external_identities
          WHERE issuer = ${fixture.issuer} AND subject IN (
            ${applicationsAcceptanceSubject("owner", fixture.runId)},
            ${applicationsAcceptanceSubject("other", fixture.runId)})) AS identities,
        (SELECT count(*)::int FROM applications.applications
          WHERE owner_user_id = ${fixture.ownerUserId}) AS applications
    `;
    return row;
  }

  it("prepares exactly two identities, then removes them and the lifecycle data exactly", async () => {
    const fixture = input("prepare");
    expect(await executeApplicationsAcceptance(client, fixture)).toMatchObject({
      action: "prepare",
      identityCount: 2,
      userCount: 2,
    });
    // A repeated prepare for the same run refuses instead of adding rows.
    await expect(executeApplicationsAcceptance(client, fixture)).rejects.toThrow(/already exists/);

    const applicationId = await appliedApplication(fixture.ownerUserId);
    expect(await presence(fixture)).toEqual({ users: 2, identities: 2, applications: 1 });

    const survivor = uuidv7();
    await client`INSERT INTO identity.users (id) VALUES (${survivor})`;
    const survivorApplication = await appliedApplication(survivor);
    try {
      const cleanup = { ...fixture, action: "cleanup" as const };
      delete (cleanup as { at?: Date }).at;
      expect(await executeApplicationsAcceptance(client, cleanup)).toEqual({
        schemaVersion: 1,
        action: "cleanup",
        identityCount: 0,
        userCount: 0,
        applicationRowCount: 0,
        applicationsDeleted: 1,
      });
      expect(await presence(fixture)).toEqual({ users: 0, identities: 0, applications: 0 });
      await expect(service.get(fixture.ownerUserId, applicationId)).rejects.toMatchObject({
        name: "ApplicationNotFoundError",
      });
      // Another candidate's data is untouched, and the tables are append-only again.
      expect((await service.get(survivor, survivorApplication)).status).toBe("applied");
      await expect(
        client`DELETE FROM applications.applications WHERE owner_user_id = ${survivor}`,
      ).rejects.toThrow(/append-only/);
    } finally {
      // The survivor is a separate generated identity; its rows stay append-only, so only its user
      // row is left for the disposable local database.
    }
  });

  it("refuses cleanup when the boundary is contaminated", async () => {
    const cleanupOf = (fixture: ApplicationsAcceptanceInput) => {
      const value = { ...fixture, action: "cleanup" as const };
      delete (value as { at?: Date }).at;
      return value;
    };

    // The foreign candidate must never own Applications data.
    const foreign = input("prepare");
    await executeApplicationsAcceptance(client, foreign);
    await appliedApplication(foreign.otherUserId);
    await expect(executeApplicationsAcceptance(client, cleanupOf(foreign))).rejects.toThrow(
      /contaminated/,
    );
    expect(await presence(foreign)).toMatchObject({ users: 2, identities: 2 });

    // Any other row that references a fixture identity blocks cleanup.
    const audited = input("prepare");
    await executeApplicationsAcceptance(client, audited);
    await client`
      INSERT INTO platform.audit_events (id, user_id, action, resource_type, resource_id, trace_id, metadata)
      VALUES (${uuidv7()}, ${audited.ownerUserId}, 'identity.linked', 'user', ${audited.ownerUserId},
              'synthetic-trace', '{}'::jsonb)
    `;
    await expect(executeApplicationsAcceptance(client, cleanupOf(audited))).rejects.toThrow(
      /contaminated/,
    );
    expect(await presence(audited)).toMatchObject({ users: 2, identities: 2 });

    // A missing fixture is not silently "clean".
    await expect(
      executeApplicationsAcceptance(client, cleanupOf(input("prepare"))),
    ).rejects.toThrow(/contaminated/);
  });
});
