import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createApplicationsDatabase,
  defaultFieldDefinitions,
  StalePacketError,
} from "@ai-job-apply/applications-service";
import { createDatabase } from "@ai-job-apply/profile-service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplicationsRuntime } from "./applications-runtime.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

const jobId = "019d04cf-1f80-7000-8000-0000000000e1";

function runtimeFor(
  client: ReturnType<typeof createApplicationsDatabase>,
  state?: { active: boolean; title: string; at: Date },
) {
  return createApplicationsRuntime({
    client,
    definitions: defaultFieldDefinitions(),
    clock: () => state?.at ?? new Date(),
    profile: { listProfileFacts: async () => ({ facts: [] }) },
    catalog: {
      async getActiveJob() {
        return null;
      },
      async resolveActiveJobSummaries() {
        return {
          catalogRevision: "r1",
          items:
            state?.active === false
              ? []
              : [
                  {
                    requestedJobId: jobId,
                    job: {
                      id: jobId,
                      company: { id: "019d04cf-1f80-7000-8000-0000000000e2", name: "Synthetic Co" },
                      title: state?.title ?? "Backend Engineer",
                      locations: ["Remote - US"],
                      firstObservedAt: new Date(),
                      lastVerifiedAt: new Date(),
                      expiresAt: new Date(Date.now() + 86_400_000),
                    },
                  },
                ],
        } as never;
      },
    },
  });
}

describeWithDatabase("Applications database client boundary", () => {
  const shared = createDatabase(databaseUrl ?? "postgres://invalid", { maxConnections: 2 });
  const dedicated = createApplicationsDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });

  beforeAll(async () => {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    for (const owner of ["profile", "applications"]) {
      await execFileAsync(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        { env },
      );
    }
  }, 60_000);

  afterAll(async () => {
    await shared.client.end({ timeout: 5 });
    await dedicated.end({ timeout: 5 });
  });

  it("creates an application over the dedicated client the gateway composes", async () => {
    const owner = uuidv7();
    const created = await runtimeFor(dedicated).create(owner, jobId, `dedicated-${uuidv7()}`);
    expect(created).toMatchObject({ canonicalJobId: jobId, status: "preparing", revision: 1 });
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
  });

  it("cannot be served by the shared gateway client, which is why it is never composed", async () => {
    // The shared client camel-cases columns and installs Drizzle's JSON and timestamp handling; the
    // store's create fails on it, exactly as the deployed Gateway did before this boundary existed.
    await expect(
      runtimeFor(shared.client).create(uuidv7(), jobId, `shared-${uuidv7()}`),
    ).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
  });

  it.each(["changed", "inactive", "expired"] as const)(
    "refuses queued dispatch through the composed owner runtime when %s",
    async (condition) => {
      const state = {
        active: true,
        title: "Synthetic Engineer",
        at: new Date("2026-09-18T12:00:00Z"),
      };
      const runtime = runtimeFor(dedicated, state);
      const owner = uuidv7();
      const formHash = "a".repeat(64);
      const created = await runtime.create(owner, jobId, `dispatch-create-${uuidv7()}`);
      const prepared = await runtime.preparePacket(
        owner,
        created.id,
        {
          expectedRevision: created.revision,
          form: { adapterId: "synthetic", variantId: "synthetic-v1", formHash },
        },
        `dispatch-packet-${uuidv7()}`,
      );
      const packet = prepared.currentPacket;
      if (!packet) throw Error("SyntheticPacketMissing");
      const approved = await runtime.approve(
        owner,
        created.id,
        {
          expectedRevision: prepared.revision,
          packetHash: packet.packetHash,
          acknowledgedFieldKeys: [],
        },
        `dispatch-approve-${uuidv7()}`,
      );
      const start = await runtime.startSubmission(
        owner,
        created.id,
        {
          expectedRevision: approved.revision,
          adapterId: "synthetic",
          adapterVersion: "1.0.0",
          observedFormHash: formHash,
        },
        `dispatch-start-${uuidv7()}`,
      );
      if (!start.attemptId) throw Error("SyntheticAttemptMissing");
      if (condition === "changed") state.title = "Synthetic Changed Role";
      else if (condition === "inactive") state.active = false;
      else state.at = new Date(state.at.getTime() + 24 * 60 * 60 * 1000);
      await expect(
        runtime.dispatchAttempt(owner, created.id, start.attemptId),
      ).rejects.toBeInstanceOf(StalePacketError);
      const view = await runtime.get(owner, created.id);
      expect(view.status).toBe("review_required");
      expect(view.currentAction).toBe("review_and_approve");
      expect(view.attempts[0]?.status).toBe("failed_no_effect");
      expect(view.attempts[0]?.dispatchedAt).toBeUndefined();
    },
  );
});
