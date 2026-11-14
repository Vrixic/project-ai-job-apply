import { createHash } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { createCoverLetterDocument, encodeCoverLetterDocument } from "./cover-letter.js";
import { createCoverLetterExportReader } from "./cover-letter-export.js";
import {
  type CoverLetterExportReference,
  PostgresCoverLetterReadStore,
} from "./cover-letter-store.js";

const owner = "019d04cf-1f80-7000-8000-000000000001";
const app = "019d04cf-1f80-7000-8000-000000000002";
const id = "019d04cf-1f80-7000-8000-000000000003";
const fact = "019d04cf-1f80-7000-8000-000000000004";
const now = new Date("2026-10-04T12:00:00Z");
function fixture() {
  const document = createCoverLetterDocument(
    {
      id,
      ownerUserId: owner,
      applicationId: app,
      version: 1,
      jobRevision: "a".repeat(64),
      confirmedFactsHash: "b".repeat(64),
    },
    {
      status: "needs_review",
      purpose: "cover_letter",
      reviewRequired: true,
      paragraphs: [{ text: "I build synthetic systems.", factIds: [fact] }],
      findings: [],
      sourceFactIds: [fact],
      confidence: 1,
      promptVersion: "1.0.0",
      model: {
        provider: "bedrock",
        model: "us.anthropic.claude-sonnet-4-6",
        version: "us.anthropic.claude-sonnet-4-6",
      },
    },
    now,
  );
  const {
    ownerUserId: _owner,
    schemaVersion: _schema,
    paragraphs: _paragraphs,
    ...reference
  } = document;
  const bytes = encodeCoverLetterDocument(document);
  const row = {
    ...document,
    status: "ready",
    createdAt: now,
    objectKey: `normalized/${id}/cover-letter.v1.json`,
    objectVersion: "synthetic-version",
    objectSha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
  let leased = false;
  const read = vi.fn(async () => {
    expect(leased).toBe(true);
    return bytes;
  });
  const transaction = vi.fn(async (query: TemplateStringsArray, ...args: unknown[]) => {
    if (query.join("").includes("identity.require_active_candidate")) {
      expect(args).toEqual([owner]);
      leased = true;
      return [];
    }
    expect(leased).toBe(true);
    if (!query.join("").includes("FROM documents.cover_letters")) return [];
    expect(args.slice(0, 2)).toEqual([owner, id]);
    return [row];
  });
  const client = Object.assign(() => {}, {
    begin: async (run: (sql: typeof transaction) => Promise<unknown>) => {
      try {
        return await run(transaction);
      } finally {
        leased = false;
      }
    },
  }) as unknown as postgres.Sql;
  const store = new PostgresCoverLetterReadStore(client, { read });
  return { document, reference, row, bytes, read, transaction, store };
}
describe("exact saved cover-letter portability", () => {
  it("reads the exact immutable version under an active-candidate lease", async () => {
    const f = fixture();
    const paragraphs = await f.store.readValue(owner, f.reference);
    expect(paragraphs).toEqual(f.document.paragraphs);
    expect(paragraphs).not.toBe(f.document.paragraphs);
    expect(f.read).toHaveBeenCalledExactlyOnceWith({
      documentId: id,
      objectKey: f.row.objectKey,
      objectVersion: "synthetic-version",
      sha256: f.row.objectSha256,
      sizeBytes: f.bytes.byteLength,
    });
    expect(
      f.transaction.mock.calls
        .find((call) => call[0].join("").includes("FROM documents.cover_letters"))?.[0]
        .join(""),
    ).not.toContain("ORDER BY version");
  });
  it.each([
    "applicationId",
    "version",
    "jobRevision",
    "confirmedFactsHash",
    "contentSha256",
    "promptVersion",
    "createdAt",
  ] as const)("rejects snapshot %s drift before object I/O", async (key) => {
    const f = fixture();
    const wrong = {
      ...f.reference,
      [key]:
        key === "version"
          ? 2
          : key === "createdAt"
            ? new Date(now.getTime() + 1).toISOString()
            : "invalid",
    };
    await expect(f.store.readValue(owner, wrong)).rejects.toThrow("integrity");
    expect(f.read).not.toHaveBeenCalled();
  });
  it("rejects model drift after verified exact object read", async () => {
    const f = fixture();
    const wrong = structuredClone(f.reference);
    Object.assign(wrong.model, { version: "foreign" });
    await expect(f.store.readValue(owner, wrong)).rejects.toThrow("integrity");
  });
  it("accepts equivalent export timestamps without requiring producer text formatting", async () => {
    const f = fixture();
    expect(
      await f.store.readValue(owner, { ...f.reference, createdAt: "2026-10-04T08:00:00-04:00" }),
    ).toEqual(f.document.paragraphs);
  });
  it("does not read pending content", async () => {
    const f = fixture();
    f.row.status = "pending";
    await expect(f.store.readValue(owner, f.reference)).rejects.toThrow("integrity");
    expect(f.read).not.toHaveBeenCalled();
  });
  it("refuses corrupt bytes without regenerating or repairing them", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce(new Uint8Array(f.bytes.byteLength));
    await expect(f.store.readValue(owner, f.reference)).rejects.toThrow("integrity");
    expect(f.read).toHaveBeenCalledTimes(1);
  });
  it("detaches caller metadata before the asynchronous lease", async () => {
    const f = fixture();
    const reference: CoverLetterExportReference = structuredClone(f.reference);
    const result = f.store.readValue(owner, reference);
    reference.version = 99;
    expect(await result).toEqual(f.document.paragraphs);
  });
  it("native factory exposes only a frozen read capability", async () => {
    const native = createCoverLetterExportReader("postgres://invalid", {
      read: async () => {
        throw Error("SyntheticUnexpectedObjectRead");
      },
    });
    expect(Object.keys(native.reader)).toEqual(["readValue"]);
    expect(Object.isFrozen(native.reader)).toBe(true);
    await expect(native.reader.readValue(owner, fixture().reference)).rejects.toThrow("integrity");
    await native.close();
  });
});
