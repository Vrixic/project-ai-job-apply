import "reflect-metadata";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import {
  ApplicationsUnavailableError,
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
  StalePacketError,
} from "@ai-job-apply/applications-service";
import { createTestTokenIssuer } from "@ai-job-apply/auth/testing";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGatewayApplication } from "./application.js";
import {
  type ApplicationsRuntimeOptions,
  createApplicationsRuntime,
} from "./applications-runtime.js";

const databaseUrl = process.env.DATABASE_URL;
const execute = promisify(execFile);
const jobId = "019d04cf-1f80-7000-8000-000000000076";
const form = { adapterId: "greenhouse", variantId: "synthetic-memory", formHash: "a".repeat(64) };
const key = () => `temporary-packet-${uuidv7()}`;

(databaseUrl ? describe : describe.skip)("original material Gateway owner composition", () => {
  const database = createApplicationsDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 3,
  });
  const profileDatabase = createDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });
  const profile = new PostgresProfileStore(profileDatabase);
  let at = new Date();
  const definitions = defaultFieldDefinitions();
  const store = new PostgresApplicationStore(database, () => at, { definitions });
  const catalog = {
    getActiveJob: async () => null,
    resolveActiveJobSummaries: async () =>
      ({
        catalogRevision: "synthetic",
        items: [
          {
            requestedJobId: jobId,
            job: {
              id: jobId,
              company: { id: jobId, name: "Synthetic employer" },
              title: "Synthetic role",
              locations: ["Remote"],
              firstObservedAt: new Date(),
              lastVerifiedAt: new Date(),
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          },
        ],
      }) as never,
  };
  const legacyTailor = vi.fn(async () => {
    throw Error("LegacyTailoringMustNotRun");
  });
  const legacyLetter = vi.fn(async () => {
    throw Error("SavedDraftBindingMustNotRun");
  });
  function runtime(memory?: ApplicationsRuntimeOptions["temporaryMaterials"]) {
    return createApplicationsRuntime({
      client: database,
      profile,
      catalog,
      definitions,
      clock: () => at,
      ...(memory ? { temporaryMaterials: memory } : {}),
      tailoring: { tailor: legacyTailor },
      coverLetters: {
        binding: legacyLetter,
        context: async () => {
          throw Error();
        },
        preview: async () => {
          throw Error();
        },
        file: async () => {
          throw Error();
        },
      },
    });
  }
  beforeAll(async () => {
    for (const owner of ["profile", "applications"]) {
      await execute(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        { env: { ...process.env, DATABASE_URL: databaseUrl } },
      );
    }
  }, 60_000);
  afterAll(async () => {
    await database.end({ timeout: 5 });
    await profileDatabase.client.end({ timeout: 5 });
  });

  async function fixture(
    kind: TemporaryMaterialReference["kind"] = "tailored_resume",
    owner = uuidv7(),
    existing?: { id: string; revision: number },
  ) {
    at = new Date();
    const noProvider = createApplicationsRuntime({
      client: database,
      profile,
      catalog,
      definitions,
      clock: () => at,
    });
    const created = existing ?? (await noProvider.create(owner, jobId, key()));
    const prepared = await noProvider.preparePacket(
      owner,
      created.id,
      { expectedRevision: created.revision, form },
      key(),
    );
    const oldPacket = prepared.currentPacket;
    if (!oldPacket) throw Error("SyntheticPacketMissing");
    const reference: TemporaryMaterialReference = {
      schemaVersion: 1,
      kind,
      generationId: uuidv7(),
      ownerUserId: owner,
      applicationId: created.id,
      version: 1,
      contentSha256: "c".repeat(64),
      completedAtMs: at.getTime() - 1,
      expiresAtMs: at.getTime() - 1 + 1_800_000,
    };
    const packeted = await store.createPacket({
      ownerUserId: owner,
      applicationId: created.id,
      expectedRevision: prepared.revision,
      idempotencyKey: key(),
      packet: {
        jobRevision: oldPacket.jobRevision,
        form,
        fields: [],
        temporaryMaterials: [reference],
        artifactHashes:
          kind === "tailored_resume"
            ? { resume: reference.contentSha256 }
            : { coverLetter: reference.contentSha256 },
      },
    });
    const packet = packeted.view.currentPacket;
    if (!packet) throw Error("SyntheticPacketMissing");
    return {
      owner,
      applicationId: created.id,
      reference,
      packeted,
      packet,
      request: {
        expectedRevision: packeted.view.application.revision,
        packetHash: packet.packetHash,
        acknowledgedFieldKeys: [],
      },
    };
  }

  it.each(["tailored_resume", "cover_letter"] as const)(
    "approves %s through current memory without legacy generation or saved draft recovery",
    async (kind) => {
      const f = await fixture(kind);
      const current = vi.fn(async () => ({ ...f.reference }));
      const result = await runtime({ current }).approve(f.owner, f.applicationId, f.request, key());
      expect(current).toHaveBeenCalledWith(f.owner, f.applicationId, f.reference);
      expect(new Date(result.approval?.expiresAt ?? "invalid").getTime()).toBe(
        f.reference.expiresAtMs,
      );
      expect(compileComponentValidator("Application")(result)).toBe(true);
      expect(result.currentPacket?.temporaryMaterials?.[0]).not.toHaveProperty("ownerUserId");
      expect(legacyTailor).not.toHaveBeenCalled();
      expect(legacyLetter).not.toHaveBeenCalled();
    },
  );
  it.each(["missing_port", "owner_outage", "foreign_owner", "body_injected"])(
    "reports %s as unavailable without invalidating metadata",
    async (fault) => {
      const f = await fixture();
      const memory =
        fault === "missing_port"
          ? undefined
          : {
              current: async () => {
                if (fault === "owner_outage") throw Error("SyntheticProviderBodyMustNotEscape");
                return {
                  ...f.reference,
                  ...(fault === "foreign_owner"
                    ? { ownerUserId: uuidv7() }
                    : { text: "synthetic forbidden draft" }),
                };
              },
            };
      await expect(
        runtime(memory).approve(f.owner, f.applicationId, f.request, key()),
      ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
      const view = await store.getApplication(f.owner, f.applicationId);
      expect(view.application.revision).toBe(f.request.expectedRevision);
      expect(view.approval).toBeNull();
    },
  );
  it.each(["lost_memory", "replacement_same_hash"])(
    "refuses %s without a legacy fallback",
    async (fault) => {
      const f = await fixture();
      const current = async () =>
        fault === "lost_memory" ? null : { ...f.reference, generationId: uuidv7() };
      await expect(
        runtime({ current }).approve(f.owner, f.applicationId, f.request, key()),
      ).rejects.toBeInstanceOf(StalePacketError);
      expect((await store.getApplication(f.owner, f.applicationId)).approval).toBeNull();
      expect(legacyTailor).not.toHaveBeenCalled();
    },
  );
  it("rechecks time after an owner read crosses the original expiry boundary", async () => {
    const f = await fixture();
    const current = async () => {
      at = new Date(f.reference.expiresAtMs);
      return { ...f.reference };
    };
    await expect(
      runtime({ current }).approve(f.owner, f.applicationId, f.request, key()),
    ).rejects.toMatchObject({
      reasons: expect.arrayContaining(["temporary_material_expired"]),
    });
    expect((await store.getApplication(f.owner, f.applicationId)).approval).toBeNull();
  });
  it("refuses known expiry without contacting an unavailable memory owner", async () => {
    const f = await fixture();
    at = new Date(f.reference.expiresAtMs);
    await expect(
      runtime().approve(f.owner, f.applicationId, f.request, key()),
    ).rejects.toMatchObject({
      reasons: expect.arrayContaining(["temporary_material_expired"]),
    });
  });

  it.each(["expired", "lost_memory"])(
    "returns a no-store 409 for %s through authenticated HTTP",
    async (fault) => {
      const issuer = await createTestTokenIssuer();
      const api = runtime({ current: async () => null });
      const app = await createGatewayApplication({
        store: profile,
        catalog: catalog as never,
        jobReports: {} as never,
        jobContributions: {} as never,
        moderation: {} as never,
        savedJobs: {} as never,
        matchAssessments: {} as never,
        entitlements: {} as never,
        documents: {} as never,
        applications: api,
        verifier: issuer.verifier,
        releaseSha: "synthetic-local",
      });
      try {
        const token = await issuer.issue(`synthetic-material-${uuidv7()}`, {
          scope: "applications:read applications:write",
        });
        const headers = { authorization: `Bearer ${token}`, "idempotency-key": key() };
        const created = await app.inject({
          method: "POST",
          url: "/v1/applications",
          headers,
          payload: { jobId },
        });
        expect(created.statusCode).toBe(201);
        const id = created.json<{ id: string }>().id;
        const [row] =
          await database`SELECT owner_user_id FROM applications.applications WHERE id = ${id}::uuid`;
        if (!row) throw Error("SyntheticOwnerMissing");
        const f = await fixture("tailored_resume", row.owner_user_id, created.json());
        if (fault === "expired") at = new Date(f.reference.expiresAtMs);
        const response = await app.inject({
          method: "POST",
          url: `/v1/applications/${f.applicationId}/approval`,
          headers: { ...headers, "idempotency-key": key() },
          payload: f.request,
        });
        expect(response.statusCode).toBe(409);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json()).toMatchObject({
          code: "application_packet_stale",
          title:
            fault === "expired" ? "Generated material expired" : "Generated material unavailable",
        });
        expect(response.body).not.toContain(f.reference.generationId);
      } finally {
        await app.close();
      }
    },
  );
});
