import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ModelGateway, OpenAiLunaProvider, OpenAiLunaResponseCleanup } from "@ai-job-apply/ai-sdk";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoverLetterDocument } from "./cover-letter.js";
import { isolatedProviderFixture } from "./cover-letter-isolated-provider-test-support.js";
import { COVER_LETTER_PROVIDER_MODEL } from "./cover-letter-provider-contract.js";
import { createCoverLetterProviderControlLambda } from "./cover-letter-provider-control-lambda.js";
import { CoverLetterResponseCaptureClient } from "./cover-letter-response-capture-client.js";
import { createCoverLetterResponseCaptureHandler } from "./cover-letter-response-capture-handler.js";
import { createCoverLetterResponseCaptureLambda } from "./cover-letter-response-capture-lambda.js";
import { CoverLetterResponseDisposalClient } from "./cover-letter-response-disposal-client.js";
import { createCoverLetterResponseDisposalHandler } from "./cover-letter-response-disposal-handler.js";
import { createCoverLetterResponseDisposalLambda } from "./cover-letter-response-disposal-lambda.js";
import {
  createCoverLetterResponseReconciler,
  createCoverLetterSuccessfulResponseReconciler,
} from "./cover-letter-response-reconciliation.js";
import { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";
import { PostgresCoverLetterStore } from "./cover-letter-store.js";
import {
  type CoverLetterWorkReference,
  PostgresCoverLetterWorkStore,
} from "./cover-letter-work-store.js";

const requested = process.env.COVER_LETTER_WORK_INTEGRATION === "1";
const databaseUrl = process.env.COVER_LETTER_WORK_TEST_DATABASE_URL;
if (requested) {
  const target = new URL(databaseUrl ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/work_ledger_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("CoverLetterResponseIntegrationTargetRejected");
}
const execute = promisify(execFile);

describe.skipIf(!requested)("original provider response inventory with real PostgreSQL", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 4, onnotice: () => undefined });
  const store = new PostgresCoverLetterResponseStore(sql, () => true);
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  const documents = new PostgresCoverLetterStore(sql, {
    putIfAbsent: async () => {
      throw Error("SyntheticUnexpectedObjectWrite");
    },
    read: async () => {
      throw Error("SyntheticUnexpectedObjectRead");
    },
  });
  let owner: string;
  let documentId: string;
  let ref: CoverLetterWorkReference;
  let reserved: Awaited<ReturnType<typeof documents.reserve>>;
  const response = () => ({
    schemaVersion: 1 as const,
    responseId: `resp_${ref.id.replaceAll("-", "")}`,
    createdAt: Math.floor(Date.now() / 1000),
  });
  const receipt = (original: ReturnType<typeof response>) => ({
    kind: "response_deleted" as const,
    reference: original,
    terminalStatus: "cancelled" as const,
  });

  beforeAll(async () => {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    );
    for (const path of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"]) {
      const args = [fileURLToPath(new URL(path, import.meta.url))];
      const options = { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: databaseUrl } };
      const first = await execute(process.execPath, args, options);
      expect((await execute(process.execPath, args, options)).stdout).toBe(first.stdout);
    }
  }, 90_000);
  beforeEach(async () => {
    owner = uuidv7();
    documentId = uuidv7();
    await sql`INSERT INTO identity.users (id) VALUES (${owner})`;
    reserved = await documents.reserve({
      id: documentId,
      ownerUserId: owner,
      applicationId: uuidv7(),
      jobRevision: "b".repeat(64),
      confirmedFactsHash: "c".repeat(64),
    });
    ref = (
      await work.issue({
        ownerUserId: owner,
        documentId,
        purpose: "provider_dispatch",
        requestSha256: "a".repeat(64),
        consentExpiresAt: new Date(Date.now() + 900_000),
      })
    ).authorization;
    // Never pass owner/state/deadline fields to the private strict reference API.
    ref = {
      id: ref.id,
      documentId: ref.documentId,
      purpose: ref.purpose,
      requestSha256: ref.requestSha256,
    };
  });
  afterEach(async () => {
    // Explicit synthetic terminal ACKs only for test fixture cleanup: no real provider exists.
    const row = await store.read(ref);
    if (row?.state === "reserved") await store.recordCreation(ref, response());
    const acknowledged = await store.read(ref);
    if (acknowledged?.state === "acknowledged" && acknowledged.response)
      await store.recordDisposal(ref, receipt(acknowledged.response));
    const [original] =
      await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`;
    if (original?.state === "running") await work.recordSettled(ref);
    await work.revokeUnclaimed(owner, documentId);
    await sql`DELETE FROM documents.audit_events WHERE user_id = ${owner}`;
    await sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`;
    await sql`DELETE FROM identity.users WHERE id = ${owner}`;
  });
  afterAll(async () => {
    await sql.end();
  });
  async function reserve() {
    await work.claim(ref);
    return store.reserve(ref);
  }

  it.each(["success", "lost_capture_ack", "quarantine", "lost_settle_ack"] as const)(
    "connects isolated actor bootstrap to native control/capture PostgreSQL: %s",
    async (fault) => {
      const extraId = uuidv7();
      await documents.reserve({
        id: extraId,
        ownerUserId: owner,
        applicationId: uuidv7(),
        jobRevision: "a".repeat(64),
        confirmedFactsHash: "b".repeat(64),
      });
      const pools: postgres.Sql[] = [];
      const privateEnv = (name: string, version: string, flag: string) => ({
        [flag]: "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: name,
        AWS_LAMBDA_FUNCTION_VERSION: version,
        AWS_SESSION_TOKEN: "synthetic-session-token",
        DATABASE_SECRET_ID:
          "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF",
      });
      const createPool = (
        url: string,
        options: { max: 1; idle_timeout: 20; connect_timeout: 10 },
      ) => {
        expect(options.max).toBe(1);
        const pool = postgres(url, options);
        pools.push(pool);
        return pool;
      };
      const resolveDatabaseUrl = async () => databaseUrl ?? "postgres://invalid";
      const control = createCoverLetterProviderControlLambda({
        environment: () =>
          privateEnv("synthetic-control", "3", "COVER_LETTER_PROVIDER_CONTROL_ENABLED"),
        resolveDatabaseUrl,
        createPool,
      });
      const capture = createCoverLetterResponseCaptureLambda({
        environment: () =>
          privateEnv("synthetic-capture", "5", "COVER_LETTER_RESPONSE_CAPTURE_ENABLED"),
        resolveDatabaseUrl,
        createPool,
      });
      let lost = false;
      const f = await isolatedProviderFixture({
        documentId: extraId,
        now: new Date(),
        rpc: async (input, target) => {
          const output = target.endsWith("synthetic-control:3")
            ? await control(input, { invokedFunctionArn: target })
            : await capture(input, { invokedFunctionArn: target });
          if (input.action === "record_creation" && fault === "quarantine")
            await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${owner}`;
          if (
            !lost &&
            ((fault === "lost_capture_ack" && input.action === "record_creation") ||
              (fault === "lost_settle_ack" && input.action === "settle"))
          ) {
            lost = true;
            throw Error("SyntheticLostCommittedPrivateACK");
          }
          return output;
        },
      });
      const issued = await work.issue({
        ownerUserId: owner,
        documentId: extraId,
        purpose: "provider_dispatch",
        requestSha256: f.input.request.sha256,
        consentExpiresAt: f.expiresAt,
      });
      const extraRef: CoverLetterWorkReference = {
        id: issued.authorization.id,
        documentId: extraId,
        purpose: "provider_dispatch",
        requestSha256: f.input.request.sha256,
      };
      try {
        expect((await f.call()).outcome).toBe(fault.startsWith("lost_") ? "in_progress" : "ready");
        expect((await f.call()).outcome).toBe(
          fault === "lost_capture_ack" ? "in_progress" : "ready",
        );
        const [row] =
          await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${extraRef.id}`;
        expect(row?.state).toBe(fault === "lost_capture_ack" ? "running" : "settled");
        const inventory = await store.read(extraRef);
        expect(inventory?.state).toBe("acknowledged");
        expect(inventory?.response?.responseId).toBe("resp_syntheticBootstrap1");
        expect(f.modelFetch).toHaveBeenCalledTimes(1);
        expect(f.createObjectClient).toHaveBeenCalledTimes(1);
        expect(f.createLambdaClient).toHaveBeenCalledTimes(1);
        expect(pools).toHaveLength(2);
        if (fault === "quarantine")
          await expect(
            work.claimFinalDocument({ ownerUserId: owner, documentId: extraId }),
          ).rejects.toThrow();
      } finally {
        await Promise.all(pools.map((pool) => pool.end()));
        const inventory = await store.read(extraRef);
        if (inventory?.state === "acknowledged" && inventory.response)
          await store.recordDisposal(extraRef, {
            kind: "response_deleted",
            reference: inventory.response,
            terminalStatus: "completed",
          });
        await work.recordSettled(extraRef); // Explicit synthetic fixture cleanup only.
        await work.revokeUnclaimed(owner, extraId);
        await sql`DELETE FROM documents.cover_letters WHERE id = ${extraId}`;
      }
    },
  );

  async function successfulDraft(
    slots: "settled" | "running" | "revoked" | "missing" = "settled",
    capture = true,
  ) {
    await reserve();
    const original = response();
    if (capture) await store.recordCreation(ref, original);
    const [binding] = await sql<Array<{ consent: Date }>>`
      SELECT consent_expires_at AS consent FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`;
    if (!binding) throw Error("SyntheticMissingOriginalBinding");
    if (slots !== "missing") {
      const slot = (
        await work.issue({
          ownerUserId: owner,
          documentId,
          purpose: "private_slots",
          requestSha256: ref.requestSha256,
          consentExpiresAt: binding.consent,
        })
      ).authorization;
      if (slots !== "revoked") await work.claim(slot);
      if (slots === "settled") await work.recordSettled(slot);
    }
    await work.recordSettled(ref); // Explicit synthetic original provider completion, never live proof.
    if (slots === "revoked") await work.revokeUnclaimed(owner, documentId);
    const factId = uuidv7();
    const draft = createCoverLetterDocument(
      reserved,
      {
        status: "needs_review",
        purpose: "cover_letter",
        reviewRequired: true,
        paragraphs: [{ text: "I build synthetic reliable systems.", factIds: [factId] }],
        sourceFactIds: [factId],
        findings: [],
        confidence: 0.95,
        promptVersion: "cover_letter.v1",
        model: COVER_LETTER_PROVIDER_MODEL,
      },
      reserved.createdAt,
    );
    let bytes: Uint8Array | undefined;
    const final = new PostgresCoverLetterStore(
      sql,
      {
        putIfAbsent: async (input) => {
          bytes = Uint8Array.from(input.bytes);
          return { objectVersion: "synthetic-final-v1", created: true };
        },
        read: async () => {
          if (!bytes) throw Error("SyntheticAbsentBytes");
          return Uint8Array.from(bytes);
        },
      },
      work,
    );
    // Revocation permanently fences finalization. This case does not manufacture ready metadata.
    if (slots === "revoked") await expect(final.complete(draft)).rejects.toThrow();
    else expect((await final.complete(draft)).status).toBe("ready");
    return original;
  }

  function completedCleanup(
    original: ReturnType<typeof response>,
    state = "completed",
    loseAck = false,
  ) {
    const methods: string[] = [];
    let removed = false;
    const cleanup = new OpenAiLunaResponseCleanup({
      enabled: () => true,
      apiKey: () => "synthetic-key",
      fetch: async (_url, options) => {
        const method = options?.method ?? "GET";
        methods.push(method);
        if (removed) return new Response(null, { status: 404 });
        if (method === "GET")
          return new Response(
            JSON.stringify({
              id: original.responseId,
              object: "response",
              created_at: original.createdAt,
              model: "gpt-6-luna",
              background: true,
              store: false,
              tools: [],
              previous_response_id: null,
              status: state,
              output: [{ text: "Synthetic output never returned." }],
            }),
          );
        if (method !== "DELETE") throw Error("SyntheticForbiddenCancellation");
        removed = true;
        if (loseAck) throw Error("SyntheticLostProviderDeletionAck");
        return new Response(
          JSON.stringify({ id: original.responseId, object: "response.deleted", deleted: true }),
        );
      },
    });
    return { cleanup, methods };
  }

  it.each([
    "none",
    "quarantined",
    "unknown",
    "legacy",
    "disabled",
    "foreign_target",
    "record_ack",
    "read_ack",
    "partial",
  ] as const)(
    "connects successful maintenance through native disposal bootstrap and exact completed-read RPC: %s",
    async (fault) => {
      const original = await successfulDraft(
        fault === "partial" ? "running" : "settled",
        fault !== "unknown",
      );
      if (fault === "quarantined")
        await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${owner}`;
      const transport = completedCleanup(original);
      const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-disposal:7";
      const env: Record<string, string | undefined> = {
        COVER_LETTER_RESPONSE_DISPOSAL_ENABLED: fault === "disabled" ? "false" : "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "synthetic-disposal",
        AWS_LAMBDA_FUNCTION_VERSION: "7",
        DATABASE_SECRET_ID:
          "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF",
        AWS_SESSION_TOKEN: "synthetic-session-token",
      };
      let pool: postgres.Sql | undefined;
      const createPool = vi.fn(
        (url: string, options: { max: 1; idle_timeout: 20; connect_timeout: 10 }) => {
          pool = postgres(url, options);
          return pool;
        },
      );
      const createResponses =
        fault === "legacy" || fault === "record_ack"
          ? (url: string, enabled: () => boolean) => {
              const responses = new PostgresCoverLetterResponseStore(
                createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 }),
                enabled,
              );
              return {
                read: responses.read.bind(responses),
                ...(fault === "legacy"
                  ? {}
                  : { readCompleted: responses.readCompleted.bind(responses) }),
                recordDisposal: async (
                  binding: CoverLetterWorkReference,
                  positive: Parameters<typeof responses.recordDisposal>[1],
                ) => {
                  await responses.recordDisposal(binding, positive);
                  if (fault === "record_ack") throw Error("SyntheticCommittedDisposalLostAck");
                },
              };
            }
          : undefined;
      const resolveDatabaseUrl = vi.fn(async () => databaseUrl ?? "postgres://invalid");
      const handler = createCoverLetterResponseDisposalLambda({
        environment: () => env,
        resolveDatabaseUrl,
        createPool,
        ...(createResponses ? { createResponses } : {}),
      });
      const actions: string[] = [];
      let lostRead = false;
      const client = new CoverLetterResponseDisposalClient(
        target,
        {
          config: { maxAttempts: async () => 1 },
          send: async (command) => {
            const input = JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array));
            actions.push(input.action);
            const output = await handler(input, {
              invokedFunctionArn: fault === "foreign_target" ? target.replace(":7", ":8") : target,
            });
            if (fault === "read_ack" && !lostRead) {
              lostRead = true;
              throw Error("SyntheticLostEligibilityAck");
            }
            return {
              StatusCode: 200,
              ExecutedVersion: "7",
              Payload: new TextEncoder().encode(JSON.stringify(output)),
            };
          },
        },
        () => true,
      );
      const reconcile = createCoverLetterSuccessfulResponseReconciler({
        responses: client,
        cleanup: transport.cleanup,
        enabled: () => true,
      });
      try {
        const positive = fault === "none" || fault === "quarantined";
        expect(await reconcile(ref, new AbortController().signal)).toEqual(
          positive ? { kind: "response_disposed", reference: ref } : { kind: "unresolved" },
        );
        expect(actions).not.toContain("read");
        expect(transport.methods).toEqual(
          positive || fault === "record_ack" ? ["GET", "DELETE"] : [],
        );
        if (positive || fault === "record_ack" || fault === "read_ack") {
          expect(await reconcile(ref, new AbortController().signal)).toEqual({
            kind: "response_disposed",
            reference: ref,
          });
          expect(transport.methods).toEqual(["GET", "DELETE"]);
          expect((await store.readCompleted(ref))?.state).toBe("disposed");
          expect(await work.readDrainState(owner, documentId)).toBe("settled");
        }
        if (fault === "disabled" || fault === "foreign_target") {
          expect(resolveDatabaseUrl).not.toHaveBeenCalled();
          expect(createPool).not.toHaveBeenCalled();
        } else {
          expect(resolveDatabaseUrl).toHaveBeenCalledTimes(1);
          expect(createPool).toHaveBeenCalledExactlyOnceWith(databaseUrl, {
            max: 1,
            idle_timeout: 20,
            connect_timeout: 10,
          });
        }
      } finally {
        await pool?.end();
        if (fault === "partial") {
          const [slot] = await sql<
            Array<{ id: string }>
          >`SELECT id FROM documents.cover_letter_work_authorizations WHERE document_id = ${documentId} AND purpose = 'private_slots'`;
          if (slot) await work.recordSettled({ ...ref, id: slot.id, purpose: "private_slots" });
        }
      }
    },
  );

  it("disposes a successful original response after actual immutable final completion, without changing work or draft", async () => {
    const original = await successfulDraft();
    const beforeWork =
      await sql`SELECT * FROM documents.cover_letter_work_authorizations WHERE document_id = ${documentId} ORDER BY purpose`;
    const beforeDraft = await sql`SELECT * FROM documents.cover_letters WHERE id = ${documentId}`;
    const transport = completedCleanup(original);
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(transport.methods).toEqual(["GET", "DELETE"]);
    expect(await reconcile(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(transport.methods).toHaveLength(2);
    expect(
      await sql`SELECT * FROM documents.cover_letter_work_authorizations WHERE document_id = ${documentId} ORDER BY purpose`,
    ).toEqual(beforeWork);
    expect(await sql`SELECT * FROM documents.cover_letters WHERE id = ${documentId}`).toEqual(
      beforeDraft,
    );
  });
  it.each(["running", "revoked", "missing"] as const)(
    "refuses successful cleanup with %s private-slot work before provider access",
    async (slots) => {
      const original = await successfulDraft(slots);
      const transport = completedCleanup(original);
      expect(await store.readCompleted(ref)).toBeNull();
      const reconcile = createCoverLetterSuccessfulResponseReconciler({
        responses: store,
        cleanup: transport.cleanup,
        enabled: () => true,
      });
      expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
      expect(transport.methods).toEqual([]);
      expect((await store.read(ref))?.state).toBe("acknowledged");
      if (slots === "running") {
        const [slot] = await sql<
          Array<{ id: string }>
        >`SELECT id FROM documents.cover_letter_work_authorizations WHERE document_id = ${documentId} AND purpose = 'private_slots'`;
        if (!slot) throw Error("SyntheticMissingSlot");
        await work.recordSettled({ ...ref, id: slot.id, purpose: "private_slots" });
      }
    },
  );
  it("refuses pending drafts and running original provider work without disposing them", async () => {
    await reserve();
    const original = response();
    await store.recordCreation(ref, original);
    const transport = completedCleanup(original);
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(transport.methods).toEqual([]);
  });
  it("keeps successful work with unknown creation identity unresolved", async () => {
    const original = await successfulDraft("settled", false);
    const transport = completedCleanup(original);
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(transport.methods).toEqual([]);
    expect((await store.read(ref))?.state).toBe("reserved");
  });
  it("allows original successful-response drain after owner quarantine without fresh admission", async () => {
    const original = await successfulDraft();
    await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${owner}`;
    const transport = completedCleanup(original);
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(transport.methods).toEqual(["GET", "DELETE"]);
    const [account] = await sql`SELECT account_state FROM identity.users WHERE id = ${owner}`;
    expect(account?.account_state).toBe("quarantined");
  });
  it("recovers successful committed-but-lost SQL disposal ACK without repeating provider effects", async () => {
    const original = await successfulDraft();
    const transport = completedCleanup(original);
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: {
        readCompleted: store.readCompleted.bind(store),
        recordDisposal: async (binding, positive) => {
          await store.recordDisposal(binding, positive);
          throw Error("SyntheticLostSqlAck");
        },
      },
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(transport.methods).toEqual(["GET", "DELETE"]);
  });
  it("does not treat lost provider DELETE ACK or subsequent 404 as success", async () => {
    const original = await successfulDraft();
    const transport = completedCleanup(original, "completed", true);
    const reconcile = createCoverLetterSuccessfulResponseReconciler({
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(transport.methods).toEqual(["GET", "DELETE", "GET"]);
    expect((await store.read(ref))?.state).toBe("acknowledged");
  });
  it.each(["queued", "in_progress", "cancelled"])(
    "never cancels or deletes unexpectedly %s provider state",
    async (state) => {
      const original = await successfulDraft();
      const transport = completedCleanup(original, state);
      const reconcile = createCoverLetterSuccessfulResponseReconciler({
        responses: store,
        cleanup: transport.cleanup,
        enabled: () => true,
      });
      expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
      expect(transport.methods).toEqual(["GET"]);
      expect((await store.read(ref))?.state).toBe("acknowledged");
    },
  );
  it("excludes non-completed durable disposal from successful replay", async () => {
    const original = await successfulDraft();
    await store.recordDisposal(ref, receipt(original));
    expect(await store.readCompleted(ref)).toBeNull();
  });
  it.each(["id", "documentId", "requestSha256"] as const)(
    "refuses changed successful binding %s and preserves original eligibility",
    async (key) => {
      await successfulDraft();
      const other = { ...ref, [key]: key === "requestSha256" ? "f".repeat(64) : uuidv7() };
      expect(await store.readCompleted(other)).toBeNull();
      expect((await store.readCompleted(ref))?.state).toBe("acknowledged");
    },
  );

  it.each([
    "none",
    "quarantined",
    "unknown",
    "disabled",
    "foreign_target",
    "secret_withdrawal",
    "record_ack",
  ] as const)(
    "connects private disposal bootstrap to a bounded native SQL pool: %s",
    async (fault) => {
      await reserve();
      const original = response();
      if (fault !== "unknown") await store.recordCreation(ref, original);
      if (fault === "quarantined")
        await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${owner}`;
      const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-disposal:7";
      const env: Record<string, string | undefined> = {
        COVER_LETTER_RESPONSE_DISPOSAL_ENABLED: fault === "disabled" ? "false" : "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "synthetic-disposal",
        AWS_LAMBDA_FUNCTION_VERSION: "7",
        DATABASE_SECRET_ID:
          "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF",
        AWS_SESSION_TOKEN: "synthetic-session-token",
      };
      let pool: postgres.Sql | undefined;
      const createPool = vi.fn(
        (url: string, options: { max: 1; idle_timeout: 20; connect_timeout: 10 }) => {
          pool = postgres(url, options);
          return pool;
        },
      );
      const resolve = vi.fn(async () => {
        if (fault === "secret_withdrawal") env.COVER_LETTER_RESPONSE_DISPOSAL_ENABLED = "false";
        return databaseUrl as string;
      });
      const recordOriginal = vi.fn<PostgresCoverLetterResponseStore["recordDisposal"]>();
      const createResponses =
        fault === "record_ack"
          ? (url: string, enabled: () => boolean) => {
              const responses = new PostgresCoverLetterResponseStore(
                createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 }),
                enabled,
              );
              recordOriginal.mockImplementation(async (reference, cleanup) => {
                await responses.recordDisposal(reference, cleanup);
                throw Error("SyntheticCommittedDisposalLostAck");
              });
              return { read: responses.read.bind(responses), recordDisposal: recordOriginal };
            }
          : undefined;
      const run = createCoverLetterResponseDisposalLambda({
        environment: () => env,
        resolveDatabaseUrl: resolve,
        createPool,
        ...(createResponses ? { createResponses } : {}),
      });
      const input = { schemaVersion: 1 as const, action: "read" as const, reference: ref };
      const context = {
        invokedFunctionArn: fault === "foreign_target" ? target.replace(":7", ":8") : target,
      };
      try {
        const readback = await run(input, context);
        if (["disabled", "foreign_target", "secret_withdrawal"].includes(fault)) {
          expect(readback).toEqual({ ...input, outcome: "unavailable", inventory: null });
          expect(createPool).not.toHaveBeenCalled();
          expect(resolve).toHaveBeenCalledTimes(fault === "secret_withdrawal" ? 1 : 0);
          return;
        }
        expect(readback).toEqual({
          ...input,
          outcome: "read",
          inventory: {
            reference: ref,
            state: fault === "unknown" ? "reserved" : "acknowledged",
            response: fault === "unknown" ? null : original,
          },
        });
        const disposal = {
          schemaVersion: 1 as const,
          action: "record_disposal" as const,
          reference: ref,
          cleanup: receipt(original),
        };
        expect(await run(disposal, context)).toEqual({
          ...disposal,
          outcome: ["record_ack", "unknown"].includes(fault) ? "unavailable" : "recorded",
        });
        expect((await store.read(ref))?.state).toBe(fault === "unknown" ? "reserved" : "disposed");
        expect((await run(input, context)).outcome).toBe("read");
        const [grant] =
          await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`;
        expect(grant?.state).toBe("running");
        expect(resolve).toHaveBeenCalledOnce();
        expect(createPool).toHaveBeenCalledExactlyOnceWith(databaseUrl, {
          max: 1,
          idle_timeout: 20,
          connect_timeout: 10,
        });
        if (fault === "record_ack") expect(recordOriginal).toHaveBeenCalledOnce();
      } finally {
        if (pool) await pool.end();
      }
    },
  );

  it.each([
    "none",
    "record_ack",
    "quarantined",
    "unknown",
    "wrong_receipt",
    "disabled",
    "read_ack",
  ] as const)(
    "connects maintenance-only disposal RPC to durable original inventory: %s",
    async (fault) => {
      await reserve();
      const original = response();
      if (fault !== "unknown") await store.recordCreation(ref, original);
      if (fault === "quarantined")
        await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${owner}`;
      const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-disposal:7";
      const readOriginal = vi.fn(store.read.bind(store));
      const recordOriginal = vi.fn(
        async (
          reference: CoverLetterWorkReference,
          cleanup: Parameters<typeof store.recordDisposal>[1],
        ) => {
          await store.recordDisposal(reference, cleanup);
          if (fault === "record_ack") throw Error("SyntheticCommittedDisposalLostAck");
        },
      );
      const handler = createCoverLetterResponseDisposalHandler({
        functionArn: target,
        responses: { read: readOriginal, recordDisposal: recordOriginal },
        enabled: () => fault !== "disabled",
      });
      const send = vi.fn(async (command: import("@aws-sdk/client-lambda").InvokeCommand) => ({
        StatusCode: 200,
        ExecutedVersion: "7",
        Payload: new TextEncoder().encode(
          JSON.stringify(
            await handler(
              JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)),
              { invokedFunctionArn: target },
            ),
          ),
        ),
      }));
      const client = new CoverLetterResponseDisposalClient(
        target,
        { send, config: { maxAttempts: async () => 1 } },
        () => true,
      );
      const unavailable = /^CoverLetterResponseDisposalUnavailable$/u;
      if (fault === "disabled") {
        await expect(client.read(ref)).rejects.toThrow(unavailable);
        await expect(client.recordDisposal(ref, receipt(original))).rejects.toThrow(unavailable);
        expect(readOriginal).not.toHaveBeenCalled();
        expect(recordOriginal).not.toHaveBeenCalled();
        return;
      }
      if (fault === "read_ack") {
        readOriginal.mockRejectedValueOnce(Error("SyntheticLostReadAck"));
        await expect(client.read(ref)).rejects.toThrow(unavailable);
      }
      const inventory = await client.read(ref);
      expect(inventory).toEqual({
        reference: ref,
        state: fault === "unknown" ? "reserved" : "acknowledged",
        response: fault === "unknown" ? null : original,
      });
      if (fault === "unknown" || fault === "wrong_receipt") {
        await expect(
          client.recordDisposal(ref, receipt({ ...original, responseId: "resp_syntheticOther" })),
        ).rejects.toThrow(unavailable);
        expect(await store.read(ref)).toEqual(inventory);
      } else {
        if (fault === "record_ack")
          await expect(client.recordDisposal(ref, receipt(original))).rejects.toThrow(unavailable);
        else await client.recordDisposal(ref, receipt(original));
        expect(await client.read(ref)).toEqual({
          reference: ref,
          state: "disposed",
          response: original,
        });
        expect(recordOriginal).toHaveBeenCalledTimes(1);
        if (fault !== "record_ack") await client.recordDisposal(ref, receipt(original));
      }
      const [grant] =
        await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`;
      expect(grant?.state).toBe("running");
      if (fault === "quarantined")
        await expect(work.claim(ref)).rejects.toThrow(/^CoverLetterWorkUnavailable$/u);
      else await expect(work.claim(ref)).resolves.toEqual({ kind: "unavailable" });
      const foreign = { ...ref, requestSha256: "f".repeat(64) };
      expect(await client.read(foreign)).toBeNull();
      await expect(client.recordDisposal(foreign, receipt(original))).rejects.toThrow(unavailable);
    },
  );

  it.each([
    "none",
    "concurrent",
    "reserve_ack",
    "creation_ack",
    "quarantined",
    "disabled",
  ] as const)(
    "connects private capture bootstrap to original real-SQL inventory: %s",
    async (fault) => {
      await work.claim(ref);
      const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-capture:3";
      const env: Record<string, string | undefined> = {
        COVER_LETTER_RESPONSE_CAPTURE_ENABLED: "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "synthetic-capture",
        AWS_LAMBDA_FUNCTION_VERSION: "3",
        AWS_SESSION_TOKEN: "synthetic-session-token",
        DATABASE_SECRET_ID:
          "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF",
      };
      let pool: postgres.Sql | undefined;
      const createPool = vi.fn(
        (url: string, options: { max: 1; idle_timeout: 20; connect_timeout: 10 }) => {
          pool = postgres(url, options);
          return pool;
        },
      );
      const resolve = vi.fn(async () => {
        if (fault === "disabled") env.COVER_LETTER_RESPONSE_CAPTURE_ENABLED = "false";
        return databaseUrl as string;
      });
      const reserveOriginal = vi.fn<PostgresCoverLetterResponseStore["reserve"]>();
      const captureOriginal = vi.fn<PostgresCoverLetterResponseStore["recordCreation"]>();
      const createCapture = (url: string, enabled: () => boolean) => {
        const original = new PostgresCoverLetterResponseStore(
          createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 }),
          enabled,
        );
        reserveOriginal.mockImplementation(async (reference) => {
          const result = await original.reserve(reference);
          if (fault === "reserve_ack") throw Error("SyntheticLostOriginalReserveAck");
          return result;
        });
        captureOriginal.mockImplementation(async (reference, response) => {
          await original.recordCreation(reference, response);
          if (fault === "creation_ack") throw Error("SyntheticLostOriginalCreationAck");
        });
        return { reserve: reserveOriginal, recordCreation: captureOriginal };
      };
      try {
        const capture = createCoverLetterResponseCaptureLambda({
          environment: () => env,
          resolveDatabaseUrl: resolve,
          createPool,
          // The ordinary case must exercise the actual default factory, not injected controls.
          ...(fault === "none" ? {} : { createCapture }),
        });
        const input = { schemaVersion: 1, action: "reserve", reference: ref };
        const outputs = await Promise.all(
          Array.from({ length: fault === "concurrent" ? 8 : 1 }, () =>
            capture(input, { invokedFunctionArn: target }),
          ),
        );
        expect(resolve).toHaveBeenCalledOnce();
        if (fault === "disabled") {
          expect(outputs[0]?.outcome).toBe("unavailable");
          expect(createPool).not.toHaveBeenCalled();
          expect(await store.read(ref)).toBeNull();
          return;
        }
        expect(createPool).toHaveBeenCalledOnce();
        expect(createPool).toHaveBeenCalledWith(databaseUrl, {
          max: 1,
          idle_timeout: 20,
          connect_timeout: 10,
        });
        if (!pool) throw Error("SyntheticPoolMissing");
        const [clock] = await pool`SELECT clock_timestamp() AS at`;
        expect(clock?.at).toBeInstanceOf(Date);
        expect((await store.read(ref))?.state).toBe("reserved");
        if (fault === "reserve_ack") {
          expect(outputs[0]?.outcome).toBe("unavailable");
          expect(reserveOriginal).toHaveBeenCalledOnce();
          expect(captureOriginal).not.toHaveBeenCalled();
          // Independent read proves a committed reservation, not replay dispatch authority.
          return;
        }
        expect(outputs.filter((output) => output.outcome === "reserved")).toHaveLength(1);
        expect(outputs.filter((output) => output.outcome === "already_reserved")).toHaveLength(
          fault === "concurrent" ? 7 : 0,
        );
        expect((await capture(input, { invokedFunctionArn: target })).outcome).toBe(
          "already_reserved",
        );
        if (fault === "quarantined")
          await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}`;
        const original = response();
        const creation = {
          schemaVersion: 1,
          action: "record_creation",
          reference: ref,
          response: original,
        };
        const captured = await capture(creation, { invokedFunctionArn: target });
        expect(captured.outcome).toBe(fault === "creation_ack" ? "unavailable" : "recorded");
        expect(await store.read(ref)).toMatchObject({ state: "acknowledged", response: original });
        if (fault === "creation_ack") expect(captureOriginal).toHaveBeenCalledOnce();
        else {
          expect(
            (
              await capture(
                { ...creation, response: { ...original, responseId: "resp_syntheticOther" } },
                { invokedFunctionArn: target },
              )
            ).outcome,
          ).toBe("unavailable");
          expect((await store.read(ref))?.response).toEqual(original);
        }
        const [phase] =
          await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`;
        expect(phase?.state).toBe("running");
        expect(resolve).toHaveBeenCalledOnce();
      } finally {
        await pool?.end();
      }
    },
  );

  function disposalTransport(original: ReturnType<typeof response>, loseDeleteAck = false) {
    const methods: string[] = [];
    let deleted = false;
    const cleanup = new OpenAiLunaResponseCleanup({
      enabled: () => true,
      apiKey: () => "synthetic",
      fetch: async (url, init) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        expect(String(url)).toBe(
          `https://api.openai.com/v1/responses/${original.responseId}${method === "POST" ? "/cancel" : ""}`,
        );
        expect(await work.readDrainState(owner, documentId)).toBe("pending");
        if (deleted) return new Response("", { status: 404 });
        if (method === "DELETE") {
          deleted = true;
          if (loseDeleteAck) throw Error("SyntheticProviderDeletionLostACK");
          return new Response(
            JSON.stringify({ object: "response.deleted", id: original.responseId, deleted: true }),
          );
        }
        return new Response(
          JSON.stringify({
            object: "response",
            id: original.responseId,
            created_at: original.createdAt,
            model: "gpt-6-luna",
            background: true,
            store: false,
            previous_response_id: null,
            tools: [],
            status: method === "POST" ? "cancelled" : "in_progress",
          }),
        );
      },
    });
    return { cleanup, methods };
  }
  it("abandoned response disposal follows the permanent fence without settling writers or granting purge", async () => {
    await reserve();
    const original = response();
    await store.recordCreation(ref, original);
    const transport = disposalTransport(original);
    const reconcile = createCoverLetterResponseReconciler({
      work,
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(transport.methods).toEqual(["GET", "POST", "DELETE"]);
    expect((await store.read(ref))?.state).toBe("disposed");
    expect(await work.readDrainState(owner, documentId)).toBe("pending");
    await expect(
      work.issue({
        ownerUserId: owner,
        documentId,
        purpose: "final_document",
        requestSha256: ref.requestSha256,
        consentExpiresAt: new Date(Date.now() + 900_000),
      }),
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
    ).rejects.toThrow();
    const before =
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`;
    expect(await reconcile(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(transport.methods).toHaveLength(3);
    expect(
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`,
    ).toEqual(before);
  });
  it("maintained disposal recovers committed-but-lost SQL ACK without repeating provider deletion", async () => {
    await reserve();
    const original = response();
    await store.recordCreation(ref, original);
    const transport = disposalTransport(original);
    const lost = createCoverLetterResponseReconciler({
      work,
      responses: {
        read: store.read.bind(store),
        recordDisposal: async (binding, positive) => {
          await store.recordDisposal(binding, positive);
          throw Error("SyntheticCommittedSqlDisposalLostACK");
        },
      },
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await lost(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect((await store.read(ref))?.state).toBe("disposed");
    expect(await lost(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(transport.methods).toHaveLength(3);
    expect(await work.readDrainState(owner, documentId)).toBe("pending");
  });
  it("unknown creation identity is permanently fenced but cannot be guessed or disposed", async () => {
    await reserve();
    const transport = disposalTransport(response());
    const reconcile = createCoverLetterResponseReconciler({
      work,
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(transport.methods).toEqual([]);
    expect(await store.read(ref)).toEqual({ reference: ref, state: "reserved", response: null });
    expect(await work.readDrainState(owner, documentId)).toBe("pending");
  });
  it("lost remote deletion ACK and later 404 never substitute for positive durable disposal", async () => {
    await reserve();
    const original = response();
    await store.recordCreation(ref, original);
    const transport = disposalTransport(original, true);
    const reconcile = createCoverLetterResponseReconciler({
      work,
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(transport.methods).toEqual(["GET", "POST", "DELETE", "GET"]);
    expect((await store.read(ref))?.state).toBe("acknowledged");
    await expect(
      sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
    ).rejects.toThrow();
  });
  it("captured original response may drain after quarantine without new admission", async () => {
    await reserve();
    const original = response();
    await store.recordCreation(ref, original);
    await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}`;
    const transport = disposalTransport(original);
    const reconcile = createCoverLetterResponseReconciler({
      work,
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({
      kind: "response_disposed",
      reference: ref,
    });
    expect(await work.readDrainState(owner, documentId)).toBe("pending");
  });
  it("lost committed cleanup-fence ACK admits no provider reconciliation", async () => {
    await reserve();
    const original = response();
    await store.recordCreation(ref, original);
    const transport = disposalTransport(original);
    const reconcile = createCoverLetterResponseReconciler({
      work: {
        fenceForCleanup: async (binding) => {
          await work.fenceForCleanup(binding);
          throw Error("SyntheticCommittedFenceLostACK");
        },
      },
      responses: store,
      cleanup: transport.cleanup,
      enabled: () => true,
    });
    expect(await reconcile(ref, new AbortController().signal)).toEqual({ kind: "unresolved" });
    expect(transport.methods).toEqual([]);
    expect((await store.read(ref))?.state).toBe("acknowledged");
    expect(await work.readDrainState(owner, documentId)).toBe("pending");
  });

  function privateCapture(loseAck?: "reserve" | "record_creation") {
    const arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-capture:7";
    const handler = createCoverLetterResponseCaptureHandler({
      functionArn: arn,
      capture: store,
      enabled: () => true,
    });
    let calls = 0;
    return {
      calls: () => calls,
      client: new CoverLetterResponseCaptureClient(
        arn,
        {
          config: { maxAttempts: async () => 1 },
          send: async (command) => {
            calls++;
            const input = JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array));
            const output = await handler(input, { invokedFunctionArn: arn });
            if (input.action === loseAck) throw Error("SyntheticCommittedLostRpcACK");
            return {
              StatusCode: 200,
              ExecutedVersion: "7",
              Payload: new TextEncoder().encode(JSON.stringify(output)),
            };
          },
        },
        () => true,
      ),
    };
  }

  it("private capture RPC commits exact original inventory and preserves replay timestamps", async () => {
    await work.claim(ref);
    const rpc = privateCapture();
    expect(await rpc.client.reserve(ref)).toEqual({ kind: "reserved" });
    const original = response();
    await rpc.client.recordCreation(ref, original);
    const before =
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`;
    expect(await rpc.client.reserve(ref)).toEqual({ kind: "already_reserved" });
    await rpc.client.recordCreation(ref, original);
    expect(
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`,
    ).toEqual(before);
    expect(await store.read(ref)).toEqual({
      reference: ref,
      state: "acknowledged",
      response: original,
    });
    expect(rpc.calls()).toBe(4);
  });

  it.each(["reserve", "record_creation"] as const)(
    "private RPC lost %s ACK retains committed inventory without retry",
    async (phase) => {
      await work.claim(ref);
      const original = response();
      if (phase === "record_creation") await store.reserve(ref);
      const rpc = privateCapture(phase);
      await expect(
        phase === "reserve" ? rpc.client.reserve(ref) : rpc.client.recordCreation(ref, original),
      ).rejects.toThrow("CoverLetterResponseCaptureUnavailable");
      expect(rpc.calls()).toBe(1);
      expect(await store.read(ref)).toEqual({
        reference: ref,
        state: phase === "reserve" ? "reserved" : "acknowledged",
        response: phase === "reserve" ? null : original,
      });
      expect(await privateCapture().client.reserve(ref)).toEqual({ kind: "already_reserved" });
      expect(
        (
          await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`
        )[0]?.state,
      ).toBe("running");
    },
  );

  it("private capture RPC drains original ACK after quarantine without renewing work", async () => {
    await work.claim(ref);
    const rpc = privateCapture();
    await rpc.client.reserve(ref);
    const before =
      await sql`SELECT * FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`;
    await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}`;
    const original = response();
    await rpc.client.recordCreation(ref, original);
    expect(await store.read(ref)).toEqual({
      reference: ref,
      state: "acknowledged",
      response: original,
    });
    expect(
      await sql`SELECT * FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`,
    ).toEqual(before);
    await expect(rpc.client.reserve(ref)).rejects.toThrow("CoverLetterResponseCaptureUnavailable");
  });

  it("private capture RPC refuses mismatched original binding before creating inventory", async () => {
    await work.claim(ref);
    const rpc = privateCapture();
    await expect(rpc.client.reserve({ ...ref, requestSha256: "f".repeat(64) })).rejects.toThrow(
      "CoverLetterResponseCaptureUnavailable",
    );
    expect(await store.read(ref)).toBeNull();
    expect(rpc.calls()).toBe(1);
  });

  async function backgroundRun(
    settings: {
      loseCaptureAck?: boolean;
      loseCreateAck?: boolean;
      alreadyReserved?: boolean;
      quarantine?: boolean;
    } = {},
  ) {
    await work.claim(ref);
    if (settings.alreadyReserved) await store.reserve(ref);
    let calls = 0;
    const original = response();
    const provider = new OpenAiLunaProvider({
      enabled: () => true,
      backgroundEnabled: () => true,
      apiKey: () => "synthetic-test-key",
      fetch: async () => {
        calls++;
        expect(await store.read(ref)).toEqual({
          reference: ref,
          state: "reserved",
          response: null,
        });
        if (settings.loseCreateAck) throw Error("SyntheticLostCreateACK");
        return new Response(
          JSON.stringify({
            object: "response",
            id: original.responseId,
            created_at: original.createdAt,
            model: "gpt-6-luna",
            background: true,
            store: false,
            previous_response_id: null,
            conversation: null,
            tools: [],
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: '{"paragraphs":[]}' }],
              },
            ],
          }),
        );
      },
    });
    const gateway = new ModelGateway(provider, { enabled: () => true });
    const run = () =>
      gateway.generateWithBackgroundCapture(
        {
          promptId: "cover_letter",
          promptVersion: "1.0.0",
          purpose: "cover_letter",
          categories: ["profile_facts", "job_posting"],
          system: "Synthetic rules",
          user: "Synthetic facts",
        },
        {
          purpose: "cover_letter",
          categories: ["profile_facts", "job_posting"],
          approvedAt: new Date(),
        },
        {
          reserve: async () => (await store.reserve(ref)).kind,
          recordCreation: async (ack) => {
            if (settings.quarantine)
              await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}`;
            await store.recordCreation(ref, ack);
            if (settings.loseCaptureAck) throw Error("SyntheticCommittedCaptureLostACK");
          },
        },
      );
    return { run, original, calls: () => calls };
  }

  it("actual background gateway reserves SQL before creation and persists identity before completion", async () => {
    const f = await backgroundRun();
    expect(await f.run()).toMatchObject({ kind: "completed" });
    expect(await store.read(ref)).toEqual({
      reference: ref,
      state: "acknowledged",
      response: f.original,
    });
    expect(f.calls()).toBe(1);
    expect(
      (
        await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`
      )[0]?.state,
    ).toBe("running");
  });
  it("committed capture with lost ACK cannot complete or redispatch and retains original SQL identity", async () => {
    const f = await backgroundRun({ loseCaptureAck: true });
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.calls()).toBe(1);
    expect(await store.read(ref)).toEqual({
      reference: ref,
      state: "acknowledged",
      response: f.original,
    });
  });
  it("lost external create ACK leaves identity-less SQL inventory and prevents redispatch", async () => {
    const f = await backgroundRun({ loseCreateAck: true });
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.calls()).toBe(1);
    expect(await store.read(ref)).toEqual({ reference: ref, state: "reserved", response: null });
  });
  it("existing SQL reservation cannot issue a model creation", async () => {
    const f = await backgroundRun({ alreadyReserved: true });
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.calls()).toBe(0);
  });
  it("original capture drains after quarantine without renewing provider authority", async () => {
    const f = await backgroundRun({ quarantine: true });
    const [before] =
      await sql`SELECT * FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`;
    expect(await f.run()).toMatchObject({ kind: "completed" });
    expect(await store.read(ref)).toEqual({
      reference: ref,
      state: "acknowledged",
      response: f.original,
    });
    expect(
      (await sql`SELECT * FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`)[0],
    ).toEqual(before);
  });

  it("commits identity-less inventory before I/O and never renews on replay", async () => {
    expect(await reserve()).toEqual({ kind: "reserved" });
    const before =
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`;
    expect(await store.reserve(ref)).toEqual({ kind: "already_reserved" });
    expect(await store.read(ref)).toEqual({ reference: ref, state: "reserved", response: null });
    expect(
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`,
    ).toEqual(before);
  });
  it("allows exactly one concurrent reservation winner", async () => {
    await work.claim(ref);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.reserve(ref)));
    expect(results.filter((x) => x.kind === "reserved")).toHaveLength(1);
    expect(results.filter((x) => x.kind === "already_reserved")).toHaveLength(7);
  });
  it("original creation and disposal replay preserves all identities/timestamps and does not settle work", async () => {
    await reserve();
    const original = response();
    await store.recordCreation(ref, original);
    const before =
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`;
    await store.recordCreation(ref, original);
    expect(
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`,
    ).toEqual(before);
    await store.recordDisposal(ref, receipt(original));
    const disposed =
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`;
    await store.recordDisposal(ref, receipt(original));
    await store.recordCreation(ref, original);
    expect(
      await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`,
    ).toEqual(disposed);
    expect(
      (
        await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id}`
      )[0]?.state,
    ).toBe("running");
  });
  it.each(["issued", "revoked", "settled"])("cannot reserve %s original work", async (state) => {
    if (state === "revoked") await work.revokeUnclaimed(owner, documentId);
    if (state === "settled") {
      await work.claim(ref);
      await work.recordSettled(ref);
    }
    await expect(store.reserve(ref)).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    expect(await store.read(ref)).toBeNull();
  });
  it("cannot reserve after quarantine, but original acknowledged work can drain after quarantine", async () => {
    await reserve();
    await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}`;
    await expect(store.reserve(ref)).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    const original = response();
    await store.recordCreation(ref, original);
    await store.recordDisposal(ref, receipt(original));
    expect((await store.read(ref))?.state).toBe("disposed");
  });
  it.each(["id", "documentId", "requestSha256"] as const)(
    "refuses wrong original %s binding",
    async (key) => {
      await reserve();
      const wrong = { ...ref, [key]: key === "requestSha256" ? "f".repeat(64) : uuidv7() };
      expect(await store.read(wrong)).toBeNull();
      await expect(store.recordCreation(wrong, response())).rejects.toThrow(
        /^CoverLetterResponseUnavailable$/u,
      );
      await expect(store.reserve(wrong)).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    },
  );
  it("refuses identity replacement, conflicting disposal and disposal before original creation ACK", async () => {
    await reserve();
    const original = response();
    await expect(store.recordDisposal(ref, receipt(original))).rejects.toThrow(
      /^CoverLetterResponseUnavailable$/u,
    );
    await store.recordCreation(ref, original);
    await expect(
      store.recordCreation(ref, { ...original, responseId: "resp_substituted" }),
    ).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    await expect(
      store.recordCreation(ref, { ...original, createdAt: original.createdAt + 1 }),
    ).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    await expect(
      store.recordDisposal(ref, receipt({ ...original, responseId: "resp_substituted" })),
    ).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    await store.recordDisposal(ref, receipt(original));
    await expect(
      store.recordDisposal(ref, { ...receipt(original), terminalStatus: "completed" }),
    ).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
  });
  it.each(["reserved", "acknowledged"])(
    "positive work settlement cannot erase %s remote inventory",
    async (state) => {
      await reserve();
      if (state === "acknowledged") await store.recordCreation(ref, response());
      await work.recordSettled(ref);
      await expect(
        sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`,
      ).rejects.toThrow();
      expect((await store.read(ref))?.state).toBe(state);
    },
  );
  it.each(["work_id", "document_id", "user_id", "request_sha256", "reserved_at", "state"])(
    "direct SQL cannot rewrite %s",
    async (column) => {
      await reserve();
      const value =
        column === "request_sha256"
          ? "f".repeat(64)
          : column === "reserved_at"
            ? new Date(Date.now() - 1000).toISOString()
            : column === "state"
              ? "disposed"
              : uuidv7();
      await expect(
        sql`UPDATE documents.cover_letter_provider_responses SET ${sql(column)} = ${value} WHERE work_id = ${ref.id}`,
      ).rejects.toThrow();
      expect((await store.read(ref))?.state).toBe("reserved");
    },
  );
  it("lost creation ACK cannot become disposed via local timeout, null ACK or direct deletion", async () => {
    await reserve();
    await expect(store.recordDisposal(ref, { kind: "unresolved" })).rejects.toThrow(
      /^CoverLetterResponseUnavailable$/u,
    );
    await expect(
      sql`DELETE FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`,
    ).rejects.toThrow();
    await expect(
      sql`UPDATE documents.cover_letter_provider_responses SET state = 'acknowledged' WHERE work_id = ${ref.id}`,
    ).rejects.toThrow();
    const original = response();
    await expect(sql`UPDATE documents.cover_letter_provider_responses
      SET state = 'acknowledged', response_id = ${original.responseId}, response_created_at = ${original.createdAt}
      WHERE work_id = ${ref.id}`).rejects.toThrow();
    expect(await store.read(ref)).toEqual({ reference: ref, state: "reserved", response: null });
  });

  it.each(["reserve", "creation", "disposal"] as const)(
    "committed but lost %s acknowledgement replays without new authority",
    async (phase) => {
      await work.claim(ref);
      const original = response();
      if (phase !== "reserve") await store.reserve(ref);
      if (phase === "disposal") await store.recordCreation(ref, original);
      const lost = new PostgresCoverLetterResponseStore(
        {
          begin: async (run: (transaction: postgres.TransactionSql) => Promise<unknown>) => {
            await sql.begin(run);
            throw Error("SyntheticLostAcknowledgement");
          },
        } as unknown as postgres.Sql,
        () => true,
      );
      const result =
        phase === "reserve"
          ? lost.reserve(ref)
          : phase === "creation"
            ? lost.recordCreation(ref, original)
            : lost.recordDisposal(ref, receipt(original));
      await expect(result).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
      const before =
        await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`;
      expect(await store.reserve(ref)).toEqual({ kind: "already_reserved" });
      if (phase === "creation") await store.recordCreation(ref, original);
      if (phase === "disposal") await store.recordDisposal(ref, receipt(original));
      expect(
        await sql`SELECT * FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`,
      ).toEqual(before);
    },
  );

  it.each(["reserve", "acknowledge"] as const)(
    "expired original authority refuses new reservation but permits existing %s drain",
    async (phase) => {
      await work.revokeUnclaimed(owner, documentId);
      await sql`DELETE FROM documents.audit_events WHERE user_id = ${owner}`;
      await sql`DELETE FROM documents.cover_letters WHERE id = ${documentId}`;
      documentId = uuidv7();
      await documents.reserve({
        id: documentId,
        ownerUserId: owner,
        applicationId: uuidv7(),
        jobRevision: "b".repeat(64),
        confirmedFactsHash: "c".repeat(64),
      });
      ref = {
        id: uuidv7(),
        documentId,
        purpose: "provider_dispatch",
        requestSha256: "a".repeat(64),
      };
      const issuedAt = new Date();
      const consentExpiresAt = new Date(issuedAt.getTime() + 900_000);
      const expiresAt = new Date(issuedAt.getTime() + 2_000);
      await sql`INSERT INTO documents.cover_letter_work_authorizations
      (id, document_id, user_id, purpose, request_sha256, consent_expires_at, issued_at, expires_at)
      VALUES (${ref.id}, ${documentId}, ${owner}, 'provider_dispatch', ${ref.requestSha256},
        ${consentExpiresAt.toISOString()}::timestamptz, ${issuedAt.toISOString()}::timestamptz,
        ${expiresAt.toISOString()}::timestamptz)`;
      await work.claim(ref);
      if (phase === "acknowledge") await store.reserve(ref);
      await sql`SELECT pg_sleep(2.1)`;
      if (phase === "reserve") {
        await expect(store.reserve(ref)).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
        expect(await store.read(ref)).toBeNull();
      } else {
        const original = response();
        await store.recordCreation(ref, original);
        await store.recordDisposal(ref, receipt(original));
        expect((await store.read(ref))?.state).toBe("disposed");
        expect(await store.reserve(ref)).toEqual({ kind: "already_reserved" });
      }
    },
  );
});
