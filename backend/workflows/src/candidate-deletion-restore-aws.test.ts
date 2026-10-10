import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  AwsReadOnlyCandidateDeletionRestoreLedger,
  AwsReadOnlyCandidateRestoreDocuments,
  type CandidateDeletionRestoreLedgerSnapshot,
} from "./candidate-deletion-restore-aws.js";
import { ACCEPTED_CANDIDATE_DELETION_POLICIES } from "./candidate-deletion-restore-policy.js";
import type {
  RestoredCandidateDocumentObjectRef,
  RestoredCandidateCoverLetterObjectRef,
} from "./candidate-deletion-restore-store.js";

const bucketName = "synthetic-restore-ledger";
const expectedBucketOwner = "123456789012";
const kmsKeyArn = "arn:aws:kms:us-east-2:123456789012:key/019c2b89-79b2-7000-8000-000000000001";
const now = new Date("2026-09-08T12:00:00.000Z");
const confirmedAt = new Date("2026-09-01T12:00:00.000Z");
const completedAt = new Date("2026-09-01T12:05:00.000Z");
const backupExpiresAt = new Date("2026-10-06T12:00:00.000Z");
const prefix = "candidate-deletion-recovery/";
const error = "CandidateDeletionRestoreCloudInspectionRejected";
type Row = Record<string, unknown>;
type Command = { constructor: { name: string }; input: Row };
type Override = (output: Row, input: Row) => unknown | Promise<unknown>;

function id(number: number): string {
  return `019c2b89-79b2-7000-8000-${number.toString(16).padStart(12, "0")}`;
}

function fixture(number = 1, historical = false) {
  const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[historical ? 0 : 1];
  if (!policy) throw new Error("Synthetic policy missing");
  const body: Row = {
    schemaVersion: 1,
    requestId: id(number),
    operationId: id(number + 1_000),
    policyVersion: policy.version,
    policySha256: policy.sha256,
    subjectDigest: createHash("sha256").update(`synthetic-subject-${number}`).digest("hex"),
    confirmedAt: confirmedAt.toISOString(),
    backupExpiresAt: backupExpiresAt.toISOString(),
    encryptedUserLocator: Buffer.from(`synthetic-ciphertext-${number}`).toString("base64"),
  };
  const key = `${prefix}${id(number)}.json`;
  const versionId = `synthetic-version-${number}+/=`;
  const bytes = () => Buffer.from(`${JSON.stringify(body)}\n`);
  const metadata = () => ({
    "request-id": body.requestId,
    "operation-id": body.operationId,
    "policy-version": body.policyVersion,
    "policy-sha256": body.policySha256,
    "subject-digest": body.subjectDigest,
    "confirmed-at": body.confirmedAt,
    "backup-expires-at": body.backupExpiresAt,
    format: "candidate-deletion-recovery-v1",
  });
  const version = (): Row => ({
    Key: key,
    VersionId: versionId,
    IsLatest: true,
    ETag: '"synthetic-etag"',
    Size: bytes().length,
    LastModified: new Date(confirmedAt),
    StorageClass: "STANDARD",
    ChecksumAlgorithm: ["SHA256"],
    ChecksumType: "FULL_OBJECT",
    Owner: { ID: "f".repeat(64) },
  });
  const object = (): Row => ({
    VersionId: versionId,
    ContentLength: bytes().length,
    ETag: '"synthetic-etag"',
    LastModified: new Date(confirmedAt),
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: kmsKeyArn,
    BucketKeyEnabled: true,
    ContentType: "application/json",
    ChecksumType: "FULL_OBJECT",
    ChecksumSHA256: createHash("sha256").update(bytes()).digest("base64"),
    ObjectLockMode: "COMPLIANCE",
    ObjectLockRetainUntilDate: new Date(String(body.backupExpiresAt)),
    Metadata: metadata(),
    Body: Readable.from([bytes().subarray(0, 17), bytes().subarray(17)]),
  });
  return { body, key, versionId, userId: id(number + 2_000), bytes, metadata, version, object };
}

function page(input: Row, versions: Row[] = []): Row {
  return {
    Name: input.Bucket,
    Prefix: input.Prefix,
    MaxKeys: input.MaxKeys,
    KeyMarker: input.KeyMarker ?? "",
    VersionIdMarker: input.VersionIdMarker ?? "",
    IsTruncated: false,
    Versions: versions,
    DeleteMarkers: [],
  };
}

function setup(fixtures = [fixture()], timeoutMs?: number) {
  const overrides: Record<string, Override> = {};
  const send = vi.fn(async (value: unknown, options?: { abortSignal?: AbortSignal }) => {
    const command = value as Command;
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    const input = command.input;
    const name = command.constructor.name;
    let result: Row;
    if (name === "ListObjectVersionsCommand") {
      result = page(
        input,
        fixtures.map((entry) => entry.version()),
      );
    } else {
      const selected = fixtures.find((entry) => entry.key === input.Key);
      if (!selected) throw new Error("Synthetic key mismatch");
      expect(input).toMatchObject({
        Bucket: bucketName,
        ExpectedBucketOwner: expectedBucketOwner,
        VersionId: selected.versionId,
      });
      if (name === "GetObjectCommand") result = selected.object();
      else if (name === "GetObjectRetentionCommand")
        result = {
          Retention: {
            Mode: "COMPLIANCE",
            RetainUntilDate: new Date(String(selected.body.backupExpiresAt)),
          },
        };
      else if (name === "GetObjectTaggingCommand")
        result = {
          VersionId: selected.versionId,
          TagSet: [
            { Key: "state", Value: "completed" },
            { Key: "completed-at", Value: completedAt.toISOString() },
          ],
        };
      else throw new Error("Non-read-only command rejected by synthetic sender");
    }
    const override =
      name === "ListObjectVersionsCommand"
        ? overrides.ListObjectVersionsCommand
        : name === "GetObjectCommand"
          ? overrides.GetObjectCommand
          : name === "GetObjectRetentionCommand"
            ? overrides.GetObjectRetentionCommand
            : overrides.GetObjectTaggingCommand;
    return override ? override.call(overrides, result, input) : result;
  });
  const decrypt = vi.fn(async (value: unknown, options?: { abortSignal?: AbortSignal }) => {
    const command = value as Command;
    expect(command.constructor.name).toBe("DecryptCommand");
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    const context = command.input.EncryptionContext as Row;
    const selected = fixtures.find((entry) => entry.body.requestId === context.requestId);
    if (!selected) throw new Error("Synthetic locator mismatch");
    expect(command.input).toEqual({
      KeyId: kmsKeyArn,
      CiphertextBlob: Buffer.from(String(selected.body.encryptedUserLocator), "base64"),
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: {
        purpose: "candidate-deletion-recovery-v1",
        requestId: selected.body.requestId,
      },
    });
    const output = {
      KeyId: kmsKeyArn,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      Plaintext: Buffer.from(selected.userId),
    };
    return overrides.DecryptCommand ? overrides.DecryptCommand(output, command.input) : output;
  });
  const ledger = new AwsReadOnlyCandidateDeletionRestoreLedger({
    bucketName,
    expectedBucketOwner,
    kmsKeyArn,
    s3: { send },
    kms: { send: decrypt },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { ledger, send, decrypt, overrides, fixtures };
}

describe("restore-only completed ledger version snapshots", () => {
  it("validates all retained versions and both exact policy identities, without cloud writes", async () => {
    const state = setup([fixture(2), fixture(1, true)]);
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    expect(snapshot).toMatchObject({
      currentPolicyMarkers: 1,
      historicalPolicyMarkers: 1,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(snapshot.entries.map((entry) => entry.requestId)).toEqual([id(1), id(2)]);
    expect(snapshot.entries[0]).toMatchObject({
      policyVersion: "d1-development-synthetic-v1",
      userId: id(2_001),
      completedAt,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0]?.confirmedAt)).toBe(true);
    await expect(
      state.ledger.assertUnchanged(snapshot, new Date(now.getTime() + 1_000)),
    ).resolves.toBeUndefined();
    for (const [command] of state.send.mock.calls) {
      const value = command as Command;
      expect([
        "ListObjectVersionsCommand",
        "GetObjectCommand",
        "GetObjectRetentionCommand",
        "GetObjectTaggingCommand",
      ]).toContain(value.constructor.name);
      expect(value.input).toMatchObject({
        Bucket: bucketName,
        ExpectedBucketOwner: expectedBucketOwner,
      });
      if (value.constructor.name !== "ListObjectVersionsCommand")
        expect(value.input.VersionId).toBeTruthy();
    }
  });

  it("returns a stable empty snapshot without claiming replayed deletions", async () => {
    const state = setup([]);
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.currentPolicyMarkers).toBe(0);
    expect(snapshot.historicalPolicyMarkers).toBe(0);
    expect(state.decrypt).not.toHaveBeenCalled();
    await expect(state.ledger.assertUnchanged(snapshot, now)).resolves.toBeUndefined();
  });

  it("inspects retained completed markers even after their minimum retention date", async () => {
    const state = setup();
    const snapshot = await state.ledger.inspectCompletedMarkers(
      new Date("2026-11-01T12:00:00.000Z"),
    );
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.backupExpiresAt).toEqual(backupExpiresAt);
  });

  it("reads every page with the exact opaque key/version cursor and re-lists before returning", async () => {
    const first = fixture(1);
    const second = fixture(2);
    const state = setup([first, second]);
    state.overrides.ListObjectVersionsCommand = (_output, input) =>
      input.KeyMarker
        ? page(input, [second.version()])
        : {
            ...page(input, [first.version()]),
            IsTruncated: true,
            NextKeyMarker: first.key,
            NextVersionIdMarker: first.versionId,
          };
    expect((await state.ledger.inspectCompletedMarkers(now)).entries).toHaveLength(2);
    expect(
      state.send.mock.calls.filter(
        ([value]) => (value as Command).constructor.name === "ListObjectVersionsCommand",
      ),
    ).toHaveLength(4);
  });

  const faults: [string, string, Override][] = [
    ["wrong listed bucket", "ListObjectVersionsCommand", (o) => ({ ...o, Name: "other-bucket" })],
    ["wrong listed prefix", "ListObjectVersionsCommand", (o) => ({ ...o, Prefix: "other/" })],
    [
      "unknown pagination state",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, IsTruncated: undefined }),
    ],
    ["malformed versions", "ListObjectVersionsCommand", (o) => ({ ...o, Versions: {} })],
    [
      "malformed delete marker array",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, DeleteMarkers: null }),
    ],
    [
      "delete marker",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, DeleteMarkers: [{ Key: fixture().key, VersionId: "deleted" }] }),
    ],
    [
      "unknown key",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, Versions: [{ ...fixture().version(), Key: `${prefix}unknown.json` }] }),
    ],
    [
      "null version",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, Versions: [{ ...fixture().version(), VersionId: "null" }] }),
    ],
    [
      "noncurrent version",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, Versions: [{ ...fixture().version(), IsLatest: false }] }),
    ],
    [
      "duplicate version",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, Versions: [fixture().version(), fixture().version()] }),
    ],
    [
      "two versions for one key",
      "ListObjectVersionsCommand",
      (o) => ({
        ...o,
        Versions: [fixture().version(), { ...fixture().version(), VersionId: "another-version" }],
      }),
    ],
    [
      "oversized listed object",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, Versions: [{ ...fixture().version(), Size: 16_385 }] }),
    ],
    ["missing next key", "ListObjectVersionsCommand", (o) => ({ ...o, IsTruncated: true })],
    [
      "empty truncated page",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, IsTruncated: true, Versions: [], NextKeyMarker: fixture().key }),
    ],
    [
      "cursor outside prefix",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, IsTruncated: true, NextKeyMarker: "different/key" }),
    ],
    [
      "malformed next version",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, IsTruncated: true, NextKeyMarker: fixture().key, NextVersionIdMarker: 42 }),
    ],
    ["unrequested encoding", "ListObjectVersionsCommand", (o) => ({ ...o, EncodingType: "url" })],
    [
      "hidden common prefixes",
      "ListObjectVersionsCommand",
      (o) => ({ ...o, CommonPrefixes: [{ Prefix: "hidden/" }] }),
    ],
    ["wrong get version", "GetObjectCommand", (o) => ({ ...o, VersionId: "another" })],
    ["wrong object size", "GetObjectCommand", (o) => ({ ...o, ContentLength: 1 })],
    ["wrong checksum", "GetObjectCommand", (o) => ({ ...o, ChecksumSHA256: "a".repeat(44) })],
    ["missing checksum", "GetObjectCommand", (o) => ({ ...o, ChecksumSHA256: undefined })],
    ["multipart checksum", "GetObjectCommand", (o) => ({ ...o, ChecksumType: "COMPOSITE" })],
    ["wrong encryption", "GetObjectCommand", (o) => ({ ...o, ServerSideEncryption: "AES256" })],
    ["wrong KMS key", "GetObjectCommand", (o) => ({ ...o, SSEKMSKeyId: `${kmsKeyArn}-wrong` })],
    [
      "wrong bucket-key configuration",
      "GetObjectCommand",
      (o) => ({ ...o, BucketKeyEnabled: false }),
    ],
    ["wrong media type", "GetObjectCommand", (o) => ({ ...o, ContentType: "text/plain" })],
    ["encoded body", "GetObjectCommand", (o) => ({ ...o, ContentEncoding: "gzip" })],
    ["partial body", "GetObjectCommand", (o) => ({ ...o, ContentRange: "bytes 0-10/100" })],
    ["wrong etag", "GetObjectCommand", (o) => ({ ...o, ETag: '"changed"' })],
    ["wrong modification date", "GetObjectCommand", (o) => ({ ...o, LastModified: now })],
    [
      "wrong metadata owner binding",
      "GetObjectCommand",
      (o) => ({ ...o, Metadata: { ...(o.Metadata as Row), "request-id": id(999) } }),
    ],
    [
      "unknown metadata",
      "GetObjectCommand",
      (o) => ({ ...o, Metadata: { ...(o.Metadata as Row), unexpected: "value" } }),
    ],
    ["missing metadata", "GetObjectCommand", (o) => ({ ...o, Metadata: {} })],
    [
      "short object retention",
      "GetObjectCommand",
      (o) => ({ ...o, ObjectLockRetainUntilDate: now }),
    ],
    [
      "governance retention",
      "GetObjectRetentionCommand",
      () => ({ Retention: { Mode: "GOVERNANCE", RetainUntilDate: backupExpiresAt } }),
    ],
    [
      "separate retention mismatch",
      "GetObjectRetentionCommand",
      () => ({ Retention: { Mode: "COMPLIANCE", RetainUntilDate: now } }),
    ],
    ["missing retention", "GetObjectRetentionCommand", () => ({})],
    ["missing completion", "GetObjectTaggingCommand", (o) => ({ ...o, TagSet: [] })],
    ["wrong tag version", "GetObjectTaggingCommand", (o) => ({ ...o, VersionId: "wrong" })],
    [
      "duplicate tag",
      "GetObjectTaggingCommand",
      (o) => ({
        ...o,
        TagSet: [
          { Key: "state", Value: "completed" },
          { Key: "state", Value: "completed" },
        ],
      }),
    ],
    [
      "incomplete marker",
      "GetObjectTaggingCommand",
      (o) => ({
        ...o,
        TagSet: [
          { Key: "state", Value: "pending" },
          { Key: "completed-at", Value: completedAt.toISOString() },
        ],
      }),
    ],
    [
      "future completion",
      "GetObjectTaggingCommand",
      (o) => ({
        ...o,
        TagSet: [
          { Key: "state", Value: "completed" },
          { Key: "completed-at", Value: "2099-01-01T00:00:00.000Z" },
        ],
      }),
    ],
    ["wrong decrypt key", "DecryptCommand", (o) => ({ ...o, KeyId: "other-key" })],
    [
      "wrong decrypt algorithm",
      "DecryptCommand",
      (o) => ({ ...o, EncryptionAlgorithm: "RSAES_OAEP_SHA_256" }),
    ],
    ["wrong decrypted type", "DecryptCommand", (o) => ({ ...o, Plaintext: id(2_001) })],
    [
      "wrong decrypted UUID",
      "DecryptCommand",
      (o) => ({ ...o, Plaintext: Buffer.from("x".repeat(36)) }),
    ],
  ];
  it.each(faults)("rejects %s before returning any snapshot", async (_name, command, override) => {
    const state = setup();
    state.overrides[command] = override;
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
  });

  it.each([
    ["unknown policy", { policyVersion: "unreviewed-v2" }],
    ["mismatched policy digest", { policySha256: "a".repeat(64) }],
    ["invalid date", { confirmedAt: "invalid" }],
    ["noncanonical date", { confirmedAt: "2026-09-01T12:00:00Z" }],
    ["wrong policy duration", { backupExpiresAt: "2026-10-05T12:00:00.000Z" }],
    ["bad ciphertext", { encryptedUserLocator: "not-base64!!!" }],
    ["extra body field", { userId: "forbidden-cleartext" }],
  ])("rejects %s in a later marker without returning a partial set", async (_name, mutation) => {
    const second = fixture(2);
    Object.assign(second.body, mutation);
    const state = setup([fixture(1), second]);
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
  });

  it("bounds the complete version set before any object body or locator read", async () => {
    const fixtures = Array.from({ length: 1_001 }, (_, index) => fixture(index + 1));
    const state = setup(fixtures);
    state.overrides.ListObjectVersionsCommand = (_output, input) => {
      const start = input.KeyMarker
        ? fixtures.findIndex((entry) => entry.key === input.KeyMarker) + 1
        : 0;
      const selected = fixtures.slice(start, start + 100);
      const last = selected.at(-1);
      return {
        ...page(
          input,
          selected.map((entry) => entry.version()),
        ),
        ...(start + 100 < fixtures.length
          ? { IsTruncated: true, NextKeyMarker: last?.key, NextVersionIdMarker: last?.versionId }
          : {}),
      };
    };
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
    expect(state.decrypt).not.toHaveBeenCalled();
    expect(
      state.send.mock.calls.every(
        ([command]) => (command as Command).constructor.name === "ListObjectVersionsCommand",
      ),
    ).toBe(true);
  });

  it("rejects repeated cursors without an unbounded request loop", async () => {
    const state = setup();
    state.overrides.ListObjectVersionsCommand = (output) => ({
      ...output,
      IsTruncated: true,
      NextKeyMarker: fixture().key,
      NextVersionIdMarker: fixture().versionId,
    });
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
    expect(state.send).toHaveBeenCalledTimes(2);
  });

  it.each([
    "oversize",
    "short",
    "invalid-utf8",
    "duplicate-json",
    "buffered-string",
    "empty-chunk",
  ])("rejects %s bodies with bounded streaming", async (fault) => {
    const state = setup();
    state.overrides.GetObjectCommand = (output) => {
      let raw = fixture().bytes();
      if (fault === "oversize") return { ...output, Body: Readable.from([Buffer.alloc(16_385)]) };
      if (fault === "short")
        return { ...output, Body: Readable.from([Buffer.from("{}").subarray(0, 1)]) };
      if (fault === "buffered-string")
        return { ...output, Body: { transformToString: async () => raw.toString() } };
      if (fault === "empty-chunk")
        return {
          ...output,
          Body: {
            async *[Symbol.asyncIterator]() {
              yield Buffer.alloc(0);
            },
          },
        };
      if (fault === "invalid-utf8") raw = Buffer.concat([Buffer.from([0xff]), raw.subarray(1)]);
      if (fault === "duplicate-json")
        raw = Buffer.from(
          raw.toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
        );
      return {
        ...output,
        Body: Readable.from([raw]),
        ContentLength: raw.length,
        ChecksumSHA256: createHash("sha256").update(raw).digest("base64"),
      };
    };
    if (fault === "duplicate-json")
      state.overrides.ListObjectVersionsCommand = (output) => ({
        ...output,
        Versions: [{ ...fixture().version(), Size: fixture().bytes().length + 18 }],
      });
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
    expect(state.decrypt).not.toHaveBeenCalled();
  });

  it("destroys an over-limit body stream immediately", async () => {
    const state = setup();
    const destroy = vi.fn();
    state.overrides.GetObjectCommand = (output) => ({
      ...output,
      Body: {
        destroy,
        async *[Symbol.asyncIterator]() {
          yield Buffer.alloc(16_385);
          throw new Error("must not consume this chunk");
        },
      },
    });
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("bounds a hung SDK request and redacts provider failures", async () => {
    const state = setup(undefined, 15);
    state.overrides.ListObjectVersionsCommand = () => new Promise(() => {});
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
    const failing = setup();
    failing.overrides.GetObjectCommand = () => {
      throw new Error("SECRET synthetic raw provider response");
    };
    await expect(failing.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
  });

  it("bounds a stalled body and honors pre-aborted callers without requests", async () => {
    const state = setup(undefined, 15);
    const destroy = vi.fn();
    state.overrides.GetObjectCommand = (output) => ({
      ...output,
      Body: {
        destroy,
        [Symbol.asyncIterator]() {
          return { next: () => new Promise(() => {}) };
        },
      },
    });
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
    expect(destroy).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    const cancelled = setup();
    await expect(cancelled.ledger.inspectCompletedMarkers(now, controller.signal)).rejects.toThrow(
      error,
    );
    expect(cancelled.send).not.toHaveBeenCalled();
  });

  it("rejects a set that changes during inspection", async () => {
    const state = setup();
    let lists = 0;
    state.overrides.ListObjectVersionsCommand = (output) =>
      ++lists === 1 ? output : { ...output, Versions: [] };
    await expect(state.ledger.inspectCompletedMarkers(now)).rejects.toThrow(error);
  });

  it("rejects cloned, cross-instance, and Date-mutated snapshots before cloud requests", async () => {
    const state = setup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    state.send.mockClear();
    await expect(state.ledger.assertUnchanged({ ...snapshot }, now)).rejects.toThrow(error);
    const other = setup();
    await expect(other.ledger.assertUnchanged(snapshot, now)).rejects.toThrow(error);
    snapshot.entries[0]?.confirmedAt.setTime(0);
    await expect(state.ledger.assertUnchanged(snapshot, now)).rejects.toThrow(error);
    await expect(
      state.ledger.assertUnchanged({} as CandidateDeletionRestoreLedgerSnapshot, now),
    ).rejects.toThrow(error);
    expect(state.send).not.toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
  });

  it("detects a changed completed-at tag even when the version and body stay identical", async () => {
    const state = setup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    state.overrides.GetObjectTaggingCommand = (output) => ({
      ...output,
      TagSet: [
        { Key: "state", Value: "completed" },
        { Key: "completed-at", Value: "2026-09-01T12:06:00.000Z" },
      ],
    });
    await expect(state.ledger.assertUnchanged(snapshot, now)).rejects.toThrow(error);
  });

  it("detects changed body and retention after an otherwise valid inspection", async () => {
    const state = setup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    const entry = state.fixtures[0];
    if (!entry) throw new Error("Synthetic entry missing");
    entry.body.operationId = id(3_001);
    await expect(state.ledger.assertUnchanged(snapshot, now)).rejects.toThrow(error);
    entry.body.operationId = id(1_001);
    state.overrides.GetObjectRetentionCommand = () => ({
      Retention: { Mode: "COMPLIANCE", RetainUntilDate: new Date("2026-10-07T12:00:00.000Z") },
    });
    await expect(state.ledger.assertUnchanged(snapshot, now)).rejects.toThrow(error);
  });
});

function document(number = 1): RestoredCandidateDocumentObjectRef {
  return {
    userId: id(2_001),
    documentId: id(number),
    sourceObjectKey: `quarantine/${id(number)}/source`,
    sourceObjectVersion: "source-version+/=",
    normalizedObjectKey: `normalized/${id(number)}/${"a".repeat(64)}/parser-v1/resume.json`,
    normalizedObjectVersion: "normalized-version+/=",
  };
}

function documentSetup(override?: Override) {
  const send = vi.fn(async (value: unknown) => {
    const command = value as Command;
    expect(command.constructor.name).toBe("ListObjectVersionsCommand");
    expect(command.input).toMatchObject({
      Bucket: bucketName,
      ExpectedBucketOwner: expectedBucketOwner,
      MaxKeys: 100,
    });
    const output = page(command.input);
    return override ? override(output, command.input) : output;
  });
  const documents = new AwsReadOnlyCandidateRestoreDocuments({
    bucketName,
    expectedBucketOwner,
    s3: { send },
  });
  return { documents, send };
}

describe("restore-only cloud document absence", () => {
  const letter = (): RestoredCandidateCoverLetterObjectRef => ({
    kind: "cover_letter",
    userId: id(2001),
    documentId: id(50),
    objectKey: `normalized/${id(50)}/cover-letter.v1.json`,
  });

  it("checks pending and ready cover namespaces without fetching content or writing S3", async () => {
    const state = documentSetup();
    const pending = letter();
    const ready = {
      ...letter(),
      documentId: id(51),
      objectKey: `normalized/${id(51)}/cover-letter.v1.json`,
      objectVersion: "retained-original",
    };
    expect(await state.documents.inspectExpectedAbsentDocuments([pending, ready])).toMatchObject({
      documentKeysChecked: 2,
      documentVersionsObserved: 0,
    });
    expect(state.send.mock.calls.map(([c]) => (c as Command).input.Prefix)).toEqual([
      `normalized/${id(50)}/`,
      `normalized/${id(51)}/`,
    ]);
  });

  it.each(["current", "historical", "delete-marker", "unregistered-generation"])(
    "refuses cover namespace %s including pending reservations",
    async (kind) => {
      const state = documentSetup((output) => ({
        ...output,
        [kind === "delete-marker" ? "DeleteMarkers" : "Versions"]: [
          {
            Key:
              kind === "unregistered-generation"
                ? `normalized/${id(50)}/generation/result.v1.json`
                : letter().objectKey,
            VersionId: "retained",
            IsLatest: kind !== "historical",
          },
        ],
      }));
      await expect(state.documents.inspectExpectedAbsentDocuments([letter()])).rejects.toThrow(
        error,
      );
    },
  );

  it.each([
    { objectKey: `normalized/${id(51)}/cover-letter.v1.json` },
    { objectVersion: "null" },
    { kind: "resume" },
    { userId: "invalid" },
    { extra: true },
    { sourceObjectKey: `quarantine/${id(50)}/source` },
  ])("rejects malformed cover refs before any cloud call %j", async (mutation) => {
    const state = documentSetup();
    await expect(
      state.documents.inspectExpectedAbsentDocuments([
        document(),
        { ...letter(), ...mutation } as RestoredCandidateCoverLetterObjectRef,
      ]),
    ).rejects.toThrow(error);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("refuses a cover/resume ID collision before any cloud call", async () => {
    const state = documentSetup();
    await expect(
      state.documents.inspectExpectedAbsentDocuments([document(50), letter()]),
    ).rejects.toThrow(error);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("honors cancellation even for an empty inventory", async () => {
    const state = documentSetup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      state.documents.inspectExpectedAbsentDocuments([], controller.signal),
    ).rejects.toThrow(error);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("checks both namespaces per document while counting only known keys and never reading bodies", async () => {
    const state = documentSetup();
    const awaiting = {
      userId: id(2_001),
      documentId: id(2),
      sourceObjectKey: `quarantine/${id(2)}/source`,
    };
    const snapshot = await state.documents.inspectExpectedAbsentDocuments([document(), awaiting]);
    expect(snapshot).toEqual({
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      documentKeysChecked: 3,
      documentVersionsObserved: 0,
    });
    expect(state.send).toHaveBeenCalledTimes(4);
    expect(state.send.mock.calls.map(([value]) => (value as Command).input.Prefix)).toEqual([
      `normalized/${id(1)}/`,
      `normalized/${id(2)}/`,
      `quarantine/${id(1)}/`,
      `quarantine/${id(2)}/`,
    ]);
    expect(await state.documents.inspectExpectedAbsentDocuments([awaiting, document()])).toEqual(
      snapshot,
    );
    expect(await state.documents.inspectExpectedAbsentDocuments([])).toMatchObject({
      documentKeysChecked: 0,
      documentVersionsObserved: 0,
    });
  });

  it("rejects a normalized artifact written before SQL persisted its optional reference", async () => {
    const pending: RestoredCandidateDocumentObjectRef = {
      userId: id(2_001),
      documentId: id(1),
      sourceObjectKey: `quarantine/${id(1)}/source`,
      sourceObjectVersion: "uploaded-source-version",
    };
    const original = { ...pending };
    const state = documentSetup((output, input) =>
      input.Prefix === `normalized/${id(1)}/`
        ? {
            ...output,
            Versions: [
              {
                Key: `normalized/${id(1)}/${"a".repeat(64)}/parser-v1/resume.json`,
                VersionId: "unregistered-normalized-version",
                IsLatest: true,
              },
            ],
          }
        : output,
    );
    await expect(state.documents.inspectExpectedAbsentDocuments([pending])).rejects.toThrow(error);
    expect(
      state.send.mock.calls.some(
        ([value]) => (value as Command).input.Prefix === `normalized/${id(1)}/`,
      ),
    ).toBe(true);
    expect(pending).toEqual(original);
  });

  it.each([
    "quarantine-current",
    "quarantine-noncurrent",
    "quarantine-delete-marker",
    "normalized-current",
    "normalized-noncurrent",
    "normalized-delete-marker",
  ])("rejects existing registered namespace state %s", async (variant) => {
    const namespace = variant.startsWith("quarantine")
      ? `quarantine/${id(1)}/`
      : `normalized/${id(1)}/`;
    const key = variant.startsWith("quarantine")
      ? document().sourceObjectKey
      : document().normalizedObjectKey;
    const state = documentSetup((output, input) =>
      input.Prefix === namespace
        ? {
            ...output,
            [variant.endsWith("delete-marker") ? "DeleteMarkers" : "Versions"]: [
              {
                Key: key,
                VersionId: "retained-version",
                IsLatest: !variant.endsWith("noncurrent"),
              },
            ],
          }
        : output,
    );
    await expect(state.documents.inspectExpectedAbsentDocuments([document()])).rejects.toThrow(
      error,
    );
  });

  it.each([
    ["missing owner", { userId: undefined }],
    ["wrong owner", { userId: "invalid" }],
    ["wrong source namespace", { sourceObjectKey: `exports/${id(1)}/source` }],
    ["different document source", { sourceObjectKey: `quarantine/${id(2)}/source` }],
    ["null source version", { sourceObjectVersion: "null" }],
    ["missing normalized version", { normalizedObjectVersion: undefined }],
    [
      "wrong normalized association",
      { normalizedObjectKey: `normalized/${id(2)}/${"a".repeat(64)}/parser-v1/resume.json` },
    ],
    [
      "normalized traversal",
      { normalizedObjectKey: `normalized/${id(1)}/${"a".repeat(64)}/../resume.json` },
    ],
    ["source version absent with normalized data", { sourceObjectVersion: undefined }],
    ["unknown inventory field", { fileName: "forbidden" }],
  ])("rejects %s anywhere in the inventory before any cloud call", async (_name, mutation) => {
    const state = documentSetup();
    await expect(
      state.documents.inspectExpectedAbsentDocuments([
        document(2),
        { ...document(), ...mutation } as RestoredCandidateDocumentObjectRef,
      ]),
    ).rejects.toThrow(error);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("rejects duplicate document/key associations and over-limit inventories before cloud calls", async () => {
    const state = documentSetup();
    await expect(
      state.documents.inspectExpectedAbsentDocuments([document(), document()]),
    ).rejects.toThrow(error);
    await expect(
      state.documents.inspectExpectedAbsentDocuments(
        Array.from({ length: 10_001 }, (_, index) => document(index + 1)),
      ),
    ).rejects.toThrow(error);
    expect(state.send).not.toHaveBeenCalled();
  });

  it.each([
    "current",
    "noncurrent",
    "delete-marker",
    "prefix-neighbor",
    "malformed-array",
    "incomplete-empty",
  ])("rejects %s rather than downloading/deleting/filtering it", async (fault) => {
    const state = documentSetup((output, input) => {
      if (fault === "malformed-array") return { ...output, Versions: {} };
      if (fault === "incomplete-empty")
        return { ...output, IsTruncated: true, NextKeyMarker: input.Prefix };
      const item = {
        Key: fault === "prefix-neighbor" ? `${input.Prefix}-unrelated` : input.Prefix,
        VersionId: "remaining",
        IsLatest: fault !== "noncurrent",
      };
      return { ...output, [fault === "delete-marker" ? "DeleteMarkers" : "Versions"]: [item] };
    });
    await expect(state.documents.inspectExpectedAbsentDocuments([document()])).rejects.toThrow(
      error,
    );
    expect(state.send).toHaveBeenCalledOnce();
  });
});

describe("restore cloud adapter configuration", () => {
  it.each([
    { bucketName: "https://bucket.example" },
    { expectedBucketOwner: "wrong-owner" },
    { kmsKeyArn: kmsKeyArn.replace("123456789012", "999999999999") },
    { kmsKeyArn: "alias/not-an-exact-key" },
    { timeoutMs: 0 },
    { timeoutMs: 600_001 },
  ])("rejects invalid exact scope before creating an inspection", (mutation) => {
    expect(
      () =>
        new AwsReadOnlyCandidateDeletionRestoreLedger({
          bucketName,
          expectedBucketOwner,
          kmsKeyArn,
          ...mutation,
          s3: { send: vi.fn() },
          kms: { send: vi.fn() },
        }),
    ).toThrow(error);
  });
});

function diagnosticSetup(fixtures = [fixture(1, true)]) {
  const state = setup(fixtures);
  for (const name of ["GetObjectCommand", "GetObjectRetentionCommand", "GetObjectTaggingCommand"]) {
    state.overrides[name] = (output) => ({ ...output, $metadata: { httpStatusCode: 200 } });
  }
  return state;
}

describe("read-only exact snapshot completion evidence accessor", () => {
  it("derives only the private exact-version metadata from independently body-verified reads", async () => {
    const state = diagnosticSetup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    const marker = await state.ledger.inspectCompletionEvidence(snapshot, now);
    const selected = state.fixtures[0];
    if (!selected) throw new Error("SyntheticMarkerMissing");
    expect(marker).toMatchObject({
      bucketName,
      expectedBucketOwner,
      key: selected.key,
      versionId: selected.versionId,
      bodySha256: createHash("sha256").update(selected.bytes()).digest("hex"),
      checksumSha256: createHash("sha256").update(selected.bytes()).digest("hex"),
      etag: '"synthetic-etag"',
      contentLength: selected.bytes().length,
      lastModified: confirmedAt.toISOString(),
      oldTagSet: [
        { Key: "completed-at", Value: completedAt.toISOString() },
        { Key: "state", Value: "completed" },
      ],
      entry: {
        requestId: selected.body.requestId,
        userId: selected.userId,
        completedAt: completedAt.toISOString(),
      },
    });
    for (const key of [
      "metadataSha256",
      "encryptionSha256",
      "retentionSha256",
      "versionInventorySha256",
    ] as const)
      expect(marker[key]).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(marker)).toBe(true);
    expect(Object.isFrozen(marker.entry)).toBe(true);
    expect(Object.isFrozen(marker.oldTagSet)).toBe(true);
    expect(Object.keys(snapshot).sort()).toEqual([
      "currentPolicyMarkers",
      "entries",
      "historicalPolicyMarkers",
      "sha256",
    ]);
    expect(
      state.send.mock.calls.filter(
        ([command]) => (command as Command).constructor.name === "GetObjectCommand",
      ),
    ).toHaveLength(2);
    for (const [command] of state.send.mock.calls)
      expect((command as Command).constructor.name).not.toMatch(/Put|Delete|Create|Update/u);
  });
  it("refuses forged/copy snapshots and snapshots minted by another reader before cloud reads", async () => {
    const state = diagnosticSetup();
    const other = diagnosticSetup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    const foreign = await other.ledger.inspectCompletedMarkers(now);
    for (const candidate of [{ ...snapshot }, structuredClone(snapshot), foreign]) {
      const before = state.send.mock.calls.length;
      await expect(state.ledger.inspectCompletionEvidence(candidate, now)).rejects.toThrow(error);
      expect(state.send.mock.calls).toHaveLength(before);
    }
  });
  it("detects mutation of a nominally frozen Date in the public snapshot", async () => {
    const state = diagnosticSetup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    snapshot.entries[0]?.completedAt?.setTime(now.getTime());
    await expect(state.ledger.inspectCompletionEvidence(snapshot, now)).rejects.toThrow(error);
  });
  it.each([0, 2])("rejects a %i-marker snapshot without selecting a target", async (count) => {
    const state = diagnosticSetup(Array.from({ length: count }, (_, i) => fixture(i + 1, true)));
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    const before = state.send.mock.calls.length;
    await expect(state.ledger.inspectCompletionEvidence(snapshot, now)).rejects.toThrow(error);
    expect(state.send.mock.calls).toHaveLength(before);
  });
  it("rechecks the entire marker set and rejects a newly added unrelated marker", async () => {
    const state = diagnosticSetup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    state.fixtures.push(fixture(2, true));
    await expect(state.ledger.inspectCompletionEvidence(snapshot, now)).rejects.toThrow(error);
  });
  it("refuses changed completion tags instead of minting a candidate against stale tags", async () => {
    const state = diagnosticSetup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    state.overrides.GetObjectTaggingCommand = (output) => ({
      ...output,
      $metadata: { httpStatusCode: 200 },
      TagSet: [
        { Key: "state", Value: "completed" },
        { Key: "completed-at", Value: "2026-09-01T12:06:00.000Z" },
      ],
    });
    await expect(state.ledger.inspectCompletionEvidence(snapshot, now)).rejects.toThrow(error);
  });
  it("preserves optional protocol checksum omission without claiming FULL_OBJECT", async () => {
    const state = diagnosticSetup();
    state.overrides.GetObjectCommand = (output) => {
      const result: Row = { ...output, $metadata: { httpStatusCode: 200 } };
      delete result.ChecksumType;
      return result;
    };
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    const marker = await state.ledger.inspectCompletionEvidence(snapshot, now);
    expect(marker.checksumSha256).toBe(marker.bodySha256);
  });
  it("keeps stricter diagnostic metadata availability isolated from original Inspect/Replay", async () => {
    const state = setup([fixture(1, true)]);
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    await expect(state.ledger.assertUnchanged(snapshot, now)).resolves.toBeUndefined();
    await expect(state.ledger.inspectCompletionEvidence(snapshot, now)).rejects.toThrow(error);
    await expect(state.ledger.assertUnchanged(snapshot, now)).resolves.toBeUndefined();
  });
  it("honors a cancelled accessor without starting another cloud request", async () => {
    const state = diagnosticSetup();
    const snapshot = await state.ledger.inspectCompletedMarkers(now);
    const controller = new AbortController();
    controller.abort();
    const before = state.send.mock.calls.length;
    await expect(
      state.ledger.inspectCompletionEvidence(snapshot, now, controller.signal),
    ).rejects.toThrow(error);
    expect(state.send.mock.calls).toHaveLength(before);
  });
});
