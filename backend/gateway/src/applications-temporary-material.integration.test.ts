import "reflect-metadata";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
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
import {
  CoverLetterReadService,
  PostgresCoverLetterStore,
  PostgresCoverLetterWorkStore,
  PostgresTemporaryMaterialCompletionStore,
  TemporaryCoverLetterService,
  TemporaryMaterialStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import { FastifyAdapter } from "@nestjs/platform-fastify";
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
    for (const owner of ["profile", "documents", "applications"]) {
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
  it.each([
    "preview",
    "pdf",
    "docx",
    "expiry",
    "cancel_race",
    "lost_memory",
    "discard_during_send",
    "cancel_cleanup",
    "confirmed_cleanup",
    "cleanup_outage_retry",
    "network_abort",
  ])(
    "serves or refuses %s through native original completion, real memory/render and authenticated HTTP",
    async (mode) => {
      const issuer = await createTestTokenIssuer();
      const subject = `synthetic-temporary-reader-${uuidv7()}`;
      const token = await issuer.issue(subject, { scope: "applications:read applications:write" });
      const owner = await profile.resolveUser(await issuer.verifier.verify(token), uuidv7());
      const f = await fixture("cover_letter", owner.id);
      const generationId = uuidv7();
      const factId = uuidv7();
      const text = "I have experience with TypeScript.";
      const evidence = {
        facts: [
          {
            id: factId,
            kind: "skill" as const,
            key: "skill",
            value: "TypeScript",
            verification: "confirmed" as const,
            sensitivity: "standard" as const,
            source: { type: "user" as const, reference: "synthetic" },
            version: 1,
          },
        ],
        job: { title: "Engineer", company: "Synthetic", description: "Build reliable systems." },
      };
      const source = { load: async () => evidence };
      const context = await new CoverLetterReadService(
        {
          withReadLease: async (_owner, run) =>
            run({
              read: async () => {
                throw Error("SavedObjectsMustNotBeRead");
              },
            }),
        },
        source,
        () => at,
      ).context({ ownerUserId: f.owner, applicationId: f.applicationId });
      const objectWrite = vi.fn(async () => {
        throw Error("GeneratedObjectsMustNotBeWritten");
      });
      const objectRead = vi.fn(async () => {
        throw Error("GeneratedObjectsMustNotBeRead");
      });
      const documents = new PostgresCoverLetterStore(database, {
        putIfAbsent: objectWrite,
        read: objectRead,
      });
      const identity = {
        id: generationId,
        ownerUserId: f.owner,
        applicationId: f.applicationId,
        version: 1,
        jobRevision: context.jobContextHash,
        confirmedFactsHash: context.confirmedFactsHash,
      };
      await documents.reserve(identity);
      const work = new PostgresCoverLetterWorkStore(database, () => true);
      const issued = await work.issue({
        ownerUserId: f.owner,
        documentId: generationId,
        purpose: "provider_dispatch",
        requestSha256: "d".repeat(64),
        consentExpiresAt: new Date(Date.now() + 900_000),
      });
      const original = {
        id: issued.authorization.id,
        documentId: generationId,
        purpose: "provider_dispatch" as const,
        requestSha256: issued.authorization.requestSha256,
      };
      expect(await work.claim(original)).toEqual({ kind: "claimed" });
      const completion = new PostgresTemporaryMaterialCompletionStore(database, () => true);
      const memory = new TemporaryMaterialStore({
        wallNow: () => at.getTime(),
        monotonicNow: () => at.getTime(),
        maximumBorrows: 1,
      });
      const temporary = new TemporaryCoverLetterService(
        memory,
        source,
        {
          claimOriginalCompletion: (reference) =>
            completion.claimOriginalCompletion(original, { ...reference }),
        },
        () => true,
        () => at,
      );
      let app: Awaited<ReturnType<typeof createGatewayApplication>> | undefined;
      try {
        at = new Date();
        const completed = await temporary.complete(
          identity,
          {
            status: "needs_review",
            purpose: "cover_letter",
            reviewRequired: true,
            paragraphs: [{ text, factIds: [factId] }],
            findings: [],
            sourceFactIds: [factId],
            confidence: 1,
            promptVersion: "cover_letter.v1",
            model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
          },
          at.getTime(),
        );
        const bound = await store.createPacket({
          ownerUserId: f.owner,
          applicationId: f.applicationId,
          expectedRevision: f.packeted.view.application.revision,
          idempotencyKey: key(),
          packet: {
            jobRevision: f.packet.jobRevision,
            form,
            fields: [],
            artifactHashes: { coverLetter: completed.reference.contentSha256 },
            temporaryMaterials: [{ ...completed.reference }],
          },
        });
        const reader = temporary.reader();
        let clearedPreview: Awaited<ReturnType<typeof reader.coverLetterPreview>> | undefined;
        let heldFile: Awaited<ReturnType<typeof reader.coverLetterFile>> | undefined;
        let nativeReadReady: () => void = () => {};
        let unblockNativeRead: () => void = () => {};
        const readReady = new Promise<void>((resolve) => {
          nativeReadReady = resolve;
        });
        const nativeReadGate = new Promise<void>((resolve) => {
          unblockNativeRead = resolve;
        });
        let cleanupAvailable = mode !== "cleanup_outage_retry";
        const api = runtime({
          ...reader,
          discardApplication: async (owner, application) => {
            if (!cleanupAvailable) throw Error("SyntheticLostDisposalAcknowledgement");
            return reader.discardApplication(owner, application);
          },
          coverLetterFile: async (owner, application, reference, format, signal) => {
            const response = await reader.coverLetterFile(
              owner,
              application,
              reference,
              format,
              signal,
            );
            if (mode === "network_abort") {
              heldFile = response;
              nativeReadReady();
              await nativeReadGate;
            }
            return response;
          },
          coverLetterPreview: async (owner, application, reference, signal) => {
            const response = await reader.coverLetterPreview(owner, application, reference, signal);
            if (mode === "cancel_race") {
              clearedPreview = response;
              await api.cancel(f.owner, f.applicationId, bound.view.application.revision, key());
            }
            return response;
          },
        });
        const adapter = new FastifyAdapter();
        if (mode === "discard_during_send")
          adapter.getInstance().addHook("onSend", async (_request, _reply, payload) => {
            memory.discard({ ...completed.reference });
            return payload;
          });
        app = await createGatewayApplication({
          adapter,
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
        if (mode === "network_abort") {
          await app.listen({ host: "127.0.0.1", port: 0 });
          const url = await app.getUrl();
          const connection = httpRequest(
            `${url}/v1/applications/${f.applicationId}/cover-letter/file?format=pdf`,
            { headers: { authorization: `Bearer ${token}` } },
          );
          connection.on("error", () => {});
          connection.end();
          await readReady;
          connection.destroy();
          await vi.waitFor(() => {
            expect(heldFile?.signal.aborted).toBe(true);
            expect(heldFile?.value.contentBase64).toBe("");
          });
          unblockNativeRead();
          expect((await api.get(f.owner, f.applicationId)).status).toBe("review_required");
          expect(memory.has({ ...completed.reference })).toBe(true);
          const next = await reader.coverLetterPreview(
            f.owner,
            f.applicationId,
            completed.reference,
          );
          next.release();
          return;
        }
        if (["cancel_cleanup", "confirmed_cleanup", "cleanup_outage_retry"].includes(mode)) {
          let attemptId: string | undefined;
          if (mode === "confirmed_cleanup") {
            const packet = bound.view.currentPacket;
            if (!packet) throw Error("SyntheticPacketMissing");
            const approved = await api.approve(
              f.owner,
              f.applicationId,
              {
                expectedRevision: bound.view.application.revision,
                packetHash: packet.packetHash,
                acknowledgedFieldKeys: [],
              },
              key(),
            );
            const started = await api.startSubmission(
              f.owner,
              f.applicationId,
              {
                expectedRevision: approved.revision,
                adapterId: "greenhouse",
                adapterVersion: "1.0.0",
                observedFormHash: form.formHash,
              },
              key(),
            );
            if (started.outcome !== "started" || !started.attemptId)
              throw Error("SyntheticAttemptMissing");
            attemptId = started.attemptId;
            await api.dispatchAttempt(f.owner, f.applicationId, attemptId);
          }
          const held = await reader.coverLetterFile(
            f.owner,
            f.applicationId,
            completed.reference,
            "pdf",
          );
          const idem = key();
          const url =
            mode === "confirmed_cleanup"
              ? `/v1/applications/${f.applicationId}/attempts/${attemptId}/result`
              : `/v1/applications/${f.applicationId}/cancel`;
          const payload =
            mode === "confirmed_cleanup"
              ? {
                  kind: "confirmed",
                  confirmation: {
                    kind: "provider_confirmation_page",
                    observedAt: at.toISOString(),
                    fingerprintSha256: "e".repeat(64),
                  },
                }
              : { expectedRevision: bound.view.application.revision };
          const gateway = app;
          const send = () =>
            gateway.inject({
              method: "POST",
              url,
              headers: { authorization: `Bearer ${token}`, "idempotency-key": idem },
              payload,
            });
          const first = await send();
          if (mode === "cleanup_outage_retry") {
            expect(first.statusCode).toBe(503);
            expect((await api.get(f.owner, f.applicationId)).status).toBe("cancelled");
            expect(held.isCurrent()).toBe(true);
            cleanupAvailable = true;
          } else expect(first.statusCode).toBe(200);
          const replay = await send();
          expect(replay.statusCode).toBe(200);
          const terminal = replay.json();
          expect(terminal.status).toBe(mode === "confirmed_cleanup" ? "applied" : "cancelled");
          expect(held.value.contentBase64).toBe("");
          expect(held.signal.aborted).toBe(true);
          expect(memory.has({ ...completed.reference })).toBe(false);
          expect(terminal.currentPacket.temporaryMaterials[0].expiresAtMs).toBe(
            completed.reference.expiresAtMs,
          );
          if (attemptId) {
            expect(terminal.attempts).toHaveLength(1);
            expect(terminal.attempts[0].status).toBe("confirmed");
            expect(terminal.attempts[0].confirmation.kind).toBe("provider_confirmation_page");
            await expect(
              api.dispatchAttempt(f.owner, f.applicationId, attemptId),
            ).rejects.toThrow();
          }
          const history = await api.history(f.owner, f.applicationId, {});
          expect(JSON.stringify(history)).not.toContain(text);
          const view = await store.getApplication(f.owner, f.applicationId);
          expect(view.application.status).toBe(terminal.status);
          expect(view.currentPacket?.temporaryMaterials?.[0]).toEqual(completed.reference);
          return;
        }
        if (mode === "expiry") at = new Date(completed.reference.expiresAtMs);
        if (mode === "lost_memory") memory.discard({ ...completed.reference });
        const suffix = mode === "pdf" || mode === "docx" ? `/file?format=${mode}` : "";
        const result = await app.inject({
          method: "GET",
          url: `/v1/applications/${f.applicationId}/cover-letter${suffix}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(result.headers["cache-control"]).toBe("no-store");
        if (["expiry", "cancel_race", "lost_memory", "discard_during_send"].includes(mode)) {
          expect(result.statusCode).toBe(409);
          expect(result.json().code).toBe("application_packet_stale");
          expect(result.body).not.toContain(text);
          if (clearedPreview) expect(clearedPreview.value).toHaveProperty("paragraphs", []);
        } else {
          expect(result.statusCode).toBe(200);
          const value = result.json();
          expect(
            compileComponentValidator(
              suffix ? "ApplicationCoverLetterFile" : "ApplicationCoverLetterPreview",
            )(value),
          ).toBe(true);
          expect(value.temporaryMaterial.generationId).toBe(generationId);
          expect(value.temporaryMaterial.expiresAtMs).toBe(completed.reference.expiresAtMs);
          expect(value.temporaryMaterial).not.toHaveProperty("ownerUserId");
          if (suffix) {
            expect(Buffer.from(value.contentBase64, "base64").length).toBe(value.sizeBytes);
            expect(value.format).toBe(mode);
          } else expect(value.paragraphs[0].text).toBe(text);
        }
        expect(objectWrite).not.toHaveBeenCalled();
        expect(objectRead).not.toHaveBeenCalled();
        const [row] =
          await database`SELECT status, material_work_id, material_expires_at_ms FROM documents.cover_letters WHERE id = ${generationId}`;
        expect(row?.status).toBe("pending");
        expect(row?.material_work_id).toBe(original.id);
        expect(Number(row?.material_expires_at_ms)).toBe(completed.reference.expiresAtMs);
        const snapshot = JSON.stringify(await store.getApplication(f.owner, f.applicationId));
        expect(snapshot).not.toContain(text);
      } finally {
        if (app) await app.close();
        memory.dispose();
      }
    },
  );
});
