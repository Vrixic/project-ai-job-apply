import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ModelGateway, OpenAiLunaProvider, OpenAiLunaResponseCleanup } from "@ai-job-apply/ai-sdk";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CoverLetterResponseCaptureClient } from "./cover-letter-response-capture-client.js";
import { createCoverLetterResponseCaptureHandler } from "./cover-letter-response-capture-handler.js";
import { createCoverLetterResponseReconciler } from "./cover-letter-response-reconciliation.js";
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
    await documents.reserve({
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
