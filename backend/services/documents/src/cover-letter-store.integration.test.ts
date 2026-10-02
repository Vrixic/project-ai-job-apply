import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { coverLetterContext, ModelGateway, type ModelProvider } from "@ai-job-apply/ai-sdk";
import type { GraphFact } from "@ai-job-apply/domain";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CoverLetterIntegrityError, createCoverLetterDocument } from "./cover-letter.js";
import { CoverLetterGenerationService } from "./cover-letter-generation.js";
import { type CoverLetterObjectStore, PostgresCoverLetterStore } from "./cover-letter-store.js";

const databaseUrl = process.env.DATABASE_URL;
const execFileAsync = promisify(execFile);
const factId = randomUUID();
const generation = {
  status: "needs_review" as const,
  purpose: "cover_letter" as const,
  reviewRequired: true as const,
  paragraphs: [{ text: "I build reliable synthetic systems.", factIds: [factId] }],
  findings: [],
  sourceFactIds: [factId],
  confidence: 0.95,
  promptVersion: "cover_letter.v1",
  model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
};

(databaseUrl ? describe : describe.skip)("Documents immutable cover-letter persistence", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 3,
    onnotice: () => undefined,
  });
  const objects = new Map<string, Uint8Array>();
  const putIfAbsent = vi.fn<CoverLetterObjectStore["putIfAbsent"]>(async (input) => {
    const existing = objects.get(input.objectKey);
    if (existing && !Buffer.from(existing).equals(Buffer.from(input.bytes)))
      throw new CoverLetterIntegrityError();
    objects.set(input.objectKey, Uint8Array.from(input.bytes));
    return { objectVersion: "synthetic-object-v1" };
  });
  const read = vi.fn<CoverLetterObjectStore["read"]>(async (input) => {
    const bytes = objects.get(input.objectKey);
    if (!bytes) throw new CoverLetterIntegrityError();
    return Uint8Array.from(bytes);
  });
  const store = new PostgresCoverLetterStore(client, { putIfAbsent, read });

  beforeAll(async () => {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    for (const migration of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"]) {
      const executable = fileURLToPath(new URL(migration, import.meta.url));
      const first = await execFileAsync(process.execPath, [executable], { env });
      const replay = await execFileAsync(process.execPath, [executable], { env });
      expect(replay.stdout).toBe(first.stdout);
    }
  });
  afterAll(async () => {
    await client.end();
  });

  async function withOwner(run: (owner: string) => Promise<void>): Promise<void> {
    const owner = randomUUID();
    await client`INSERT INTO identity.users (id) VALUES (${owner})`;
    try {
      await run(owner);
    } finally {
      await client`DELETE FROM documents.audit_events WHERE user_id = ${owner}`;
      await client`DELETE FROM identity.users WHERE id = ${owner}`;
    }
  }
  const input = (ownerUserId: string) => ({
    id: randomUUID(),
    ownerUserId,
    applicationId: randomUUID(),
    jobRevision: "a".repeat(64),
    confirmedFactsHash: "b".repeat(64),
  });

  it("generates once across duplicate internal delivery and serves only the saved context-bound draft", async () => {
    await withOwner(async (owner) => {
      const now = new Date("2026-10-02T12:00:00Z");
      const fact: GraphFact = {
        id: factId,
        kind: "skill",
        key: "skill",
        value: "TypeScript",
        verification: "confirmed",
        sensitivity: "standard",
        source: { type: "user", reference: "synthetic" },
        version: 1,
      };
      let job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
      let release: () => void = () => undefined;
      let entered: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const dispatching = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const complete = vi.fn<ModelProvider["complete"]>(async () => {
        entered();
        await gate;
        return {
          text: JSON.stringify({
            paragraphs: [{ text: "I have experience with TypeScript.", factIds: [factId] }],
          }),
        };
      });
      // Real database/object-owner flow with an offline scripted provider, not live OpenAI.
      const gateway = new ModelGateway(
        { identity: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" }, complete },
        { enabled: () => true, clock: () => now },
      );
      const service = new CoverLetterGenerationService(
        store,
        { load: async () => ({ facts: [fact], job }) },
        gateway,
        () => now,
      );
      const request = {
        id: randomUUID(),
        ownerUserId: owner,
        applicationId: randomUUID(),
        ...coverLetterContext({ facts: [fact], job, now }),
        noticeVersion: "openai-cover-letter.v1",
        approvedAt: now,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
      };
      const first = service.generate(request);
      await dispatching;
      try {
        expect(await service.generate(request)).toEqual({ kind: "in_progress" });
        expect(complete).toHaveBeenCalledTimes(1);
      } finally {
        release();
      }
      const result = await first;
      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") throw new Error("Synthetic generation did not complete");
      expect(await service.generate(request)).toEqual(result);
      expect(await service.recover(request)).toEqual(result.letter);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(await service.binding(owner, request.applicationId, result.letter.contentSha256)).toBe(
        result.letter.contentSha256,
      );
      expect(
        await service.preview(owner, request.applicationId, result.letter.contentSha256),
      ).toMatchObject({ matchesPacket: true, reviewRequired: true });
      for (const format of ["pdf", "docx"] as const) {
        expect(
          await service.file(owner, request.applicationId, result.letter.contentSha256, format),
        ).toMatchObject({ format, contentSha256: result.letter.contentSha256 });
      }
      const rows =
        await client`SELECT status FROM documents.cover_letters WHERE id = ${request.id}`;
      expect(rows).toEqual([{ status: "ready" }]);
      job = { ...job, description: `${job.description} Changed.` };
      expect(
        await service.binding(owner, request.applicationId, result.letter.contentSha256),
      ).toBeUndefined();
      expect(
        await service.preview(owner, request.applicationId, result.letter.contentSha256),
      ).toMatchObject({ matchesPacket: false });
      await expect(
        service.file(owner, request.applicationId, result.letter.contentSha256, "pdf"),
      ).rejects.toThrow(CoverLetterIntegrityError);
      expect(complete).toHaveBeenCalledTimes(1);
    });
  });

  it("serializes a bounded model dispatch with quarantine and refuses a later dispatch", async () => {
    await withOwner(async (owner) => {
      let release: () => void = () => undefined;
      let entered: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const dispatching = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const run = vi.fn(async () => {
        entered();
        await gate;
        return "synthetic-result";
      });
      const leased = store.withGenerationLease(owner, run);
      await dispatching;
      try {
        await expect(
          client.begin(async (transaction) => {
            await transaction`SET LOCAL lock_timeout = '25ms'`;
            await transaction`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}`;
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        release();
      }
      expect(await leased).toBe("synthetic-result");
      await client`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now() WHERE id = ${owner}`;
      const refused = vi.fn(async () => "synthetic-result");
      await expect(store.withGenerationLease(owner, refused)).rejects.toMatchObject({
        code: "42501",
      });
      expect(refused).not.toHaveBeenCalled();
    });
  });

  it("reserves before object I/O, deduplicates concurrent delivery and binds conflicts", async () => {
    await withOwner(async (owner) => {
      const request = input(owner);
      const before = putIfAbsent.mock.calls.length;
      const [first, replay] = await Promise.all([store.reserve(request), store.reserve(request)]);
      expect(first).toEqual(replay);
      expect(first.version).toBe(1);
      expect(await store.recover(request)).toBeNull();
      expect(putIfAbsent.mock.calls.length).toBe(before);
      await expect(store.reserve({ ...request, jobRevision: "c".repeat(64) })).rejects.toThrow(
        CoverLetterIntegrityError,
      );
      const second = await store.reserve({ ...request, id: randomUUID() });
      expect(second.version).toBe(2);
      const inventory = await client<Array<{ data: Array<Record<string, unknown>> }>>`
        SELECT documents.candidate_object_inventory(${owner}::uuid) AS data
      `;
      expect(inventory[0]?.data).toEqual(
        expect.arrayContaining([
          { documentId: first.id, sourceObjectKey: first.objectKey },
          { documentId: second.id, sourceObjectKey: second.objectKey },
        ]),
      );
    });
  });

  it("persists a ready draft once, reads exact bindings and keeps SQL/audit value-free", async () => {
    await withOwner(async (owner) => {
      const reserved = await store.reserve(input(owner));
      const document = createCoverLetterDocument(reserved, generation, reserved.createdAt);
      const before = putIfAbsent.mock.calls.length;
      const [ready, replay] = await Promise.all([
        store.complete(document),
        store.complete(document),
      ]);
      expect(ready).toEqual(replay);
      expect(putIfAbsent.mock.calls.length - before).toBe(1);
      expect(await store.read(owner, reserved.applicationId, document.contentSha256)).toEqual(
        document,
      );
      const recovery = {
        id: reserved.id,
        ownerUserId: owner,
        applicationId: reserved.applicationId,
        jobRevision: reserved.jobRevision,
        confirmedFactsHash: reserved.confirmedFactsHash,
      };
      expect(await store.recover(recovery)).toEqual(document);
      // A later reservation cannot redirect recovery away from the original operation.
      await store.reserve({ ...recovery, id: randomUUID() });
      expect(await store.recover(recovery)).toEqual(document);
      const readBefore = read.mock.calls.length;
      expect(await store.recover({ ...recovery, ownerUserId: randomUUID() })).toBeNull();
      expect(await store.recover({ ...recovery, applicationId: randomUUID() })).toBeNull();
      expect(await store.recover({ ...recovery, id: randomUUID() })).toBeNull();
      await expect(store.recover({ ...recovery, jobRevision: "c".repeat(64) })).rejects.toThrow(
        CoverLetterIntegrityError,
      );
      await expect(
        store.recover({ ...recovery, confirmedFactsHash: "c".repeat(64) }),
      ).rejects.toThrow(CoverLetterIntegrityError);
      expect(
        await store.read(randomUUID(), reserved.applicationId, document.contentSha256),
      ).toBeNull();
      expect(await store.read(owner, randomUUID(), document.contentSha256)).toBeNull();
      expect(await store.read(owner, reserved.applicationId, "c".repeat(64))).toBeNull();
      expect(read.mock.calls.length).toBe(readBefore);
      const [{ data } = { data: null }] = await client<Array<{ data: unknown }>>`
        SELECT documents.export_candidate_data(${owner}::uuid) AS data
      `;
      expect(JSON.stringify(data)).toContain("coverLetters");
      expect(JSON.stringify(data)).not.toContain(document.paragraphs[0]?.text);
      expect(JSON.stringify(data)).not.toContain("normalized/");
      const audits = await client`SELECT * FROM documents.audit_events WHERE user_id = ${owner}`;
      expect(audits).toHaveLength(3);
      expect(JSON.stringify(audits)).not.toContain(document.paragraphs[0]?.text);
      await expect(client`
        UPDATE documents.cover_letters SET prompt_version = 'altered' WHERE id = ${document.id}
      `).rejects.toMatchObject({ code: "55000" });
    });
  });

  it("keeps an ambiguous object write inventoried and safely completes its retry", async () => {
    await withOwner(async (owner) => {
      const reserved = await store.reserve(input(owner));
      const document = createCoverLetterDocument(reserved, generation, reserved.createdAt);
      const uncertain = new PostgresCoverLetterStore(client, {
        read,
        async putIfAbsent(value) {
          await putIfAbsent(value);
          throw new Error("Synthetic lost response");
        },
      });
      await expect(uncertain.complete(document)).rejects.toThrow("Synthetic lost response");
      const rows =
        await client`SELECT status FROM documents.cover_letters WHERE id = ${document.id}`;
      expect(rows[0]?.status).toBe("pending");
      expect(await store.read(owner, reserved.applicationId, document.contentSha256)).toBeNull();
      const inventory = await client<Array<{ data: unknown }>>`
        SELECT documents.candidate_object_inventory(${owner}::uuid) AS data
      `;
      expect(JSON.stringify(inventory[0]?.data)).toContain(reserved.objectKey);
      expect((await store.complete(document)).status).toBe("ready");
    });
  });

  it("holds a bounded write lease against concurrent account quarantine", async () => {
    await withOwner(async (owner) => {
      const reserved = await store.reserve(input(owner));
      const document = createCoverLetterDocument(reserved, generation, reserved.createdAt);
      let release: () => void = () => undefined;
      let entered: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const leased = new PostgresCoverLetterStore(client, {
        read,
        async putIfAbsent(value) {
          entered();
          await gate;
          return putIfAbsent(value);
        },
      });
      const completion = leased.complete(document);
      await writing;
      try {
        await expect(
          client.begin(async (transaction) => {
            await transaction`SET LOCAL lock_timeout = '25ms'`;
            await transaction`
            UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now()
            WHERE id = ${owner}
          `;
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        release();
      }
      expect((await completion).status).toBe("ready");
    });
  });

  it("requires privacy authorization and empty exact objects before deleting pending and ready rows", async () => {
    await withOwner(async (owner) => {
      const first = await store.reserve(input(owner));
      await store.reserve({ ...input(owner), applicationId: first.applicationId });
      const document = createCoverLetterDocument(first, generation, first.createdAt);
      await store.complete(document);
      await expect(client`
        SELECT documents.delete_candidate_data(${owner}::uuid, ${randomUUID()}::uuid, true)
      `).rejects.toMatchObject({ code: "42501" });
      const operationId = randomUUID();
      const requestId = randomUUID();
      await client`
        INSERT INTO platform.operations (id, user_id, kind, state)
        VALUES (${operationId}, ${owner}, 'account_deletion', 'queued')
      `;
      await client`
        INSERT INTO profile.account_deletion_requests (
          id, user_id, operation_id, policy_version, state, version, confirmed_at, backup_expires_at
        ) VALUES (${requestId}, ${owner}, ${operationId}, 'synthetic-cover-letter-rights-v1',
          'quarantined', 2, now(), now() + interval '35 days')
      `;
      await client`
        INSERT INTO privacy.account_deletion_ledger (
          request_id, subject_digest, policy_version, policy_sha256, state,
          owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at
        ) VALUES (${requestId}, ${"1".repeat(64)}, 'synthetic-cover-letter-rights-v1',
          ${"2".repeat(64)}, 'quarantined', '{"documents":"pending"}'::jsonb, '{}'::jsonb,
          now(), now() + interval '35 days')
      `;
      try {
        await expect(client`
          SELECT documents.delete_candidate_data(${owner}::uuid, ${requestId}::uuid, false)
        `).rejects.toMatchObject({ code: "55000" });
        objects.delete(first.objectKey);
        const result = await client<Array<{ data: { coverLettersDeleted: number } }>>`
          SELECT documents.delete_candidate_data(${owner}::uuid, ${requestId}::uuid, true) AS data
        `;
        expect(result[0]?.data.coverLettersDeleted).toBe(2);
        expect(await store.read(owner, first.applicationId, document.contentSha256)).toBeNull();
        const inventory = await client<Array<{ data: unknown }>>`
          SELECT documents.candidate_object_inventory(${owner}::uuid) AS data
        `;
        expect(inventory[0]?.data).toEqual([]);
      } finally {
        await client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}`;
      }
    });
  });

  it("refuses altered stored bytes and quarantine-time writes", async () => {
    await withOwner(async (owner) => {
      const reserved = await store.reserve(input(owner));
      const document = createCoverLetterDocument(reserved, generation, reserved.createdAt);
      await store.complete(document);
      objects.set(reserved.objectKey, new TextEncoder().encode("Synthetic corruption"));
      await expect(
        store.read(owner, reserved.applicationId, document.contentSha256),
      ).rejects.toThrow(CoverLetterIntegrityError);
      await client`
        UPDATE identity.users SET account_state = 'quarantined', quarantined_at = now()
        WHERE id = ${owner}
      `;
      await expect(store.reserve(input(owner))).rejects.toMatchObject({ code: "42501" });
      await expect(store.complete(document)).rejects.toMatchObject({ code: "42501" });
    });
  });
});
