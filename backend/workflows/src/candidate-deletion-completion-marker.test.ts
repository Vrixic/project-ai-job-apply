import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test, vi } from "vitest";
import {
  type CompletionMarkerAwsEvidence,
  completionMarkerObservationFromAws,
  completionMarkerVersionFingerprint,
  completionMarkerVersionFromListing,
} from "./candidate-deletion-completion-marker-evidence.js";
import {
  COMPLETION_MARKER_READ_TIMEOUT_MS,
  createCompletionMarkerS3Reader,
} from "./candidate-deletion-completion-marker-s3.js";
import { COMPLETION_REPAIR_S3_CONFIGURATION } from "./candidate-deletion-completion-tag-repair.js";

afterEach(() => {
  vi.useRealTimers();
});

const clone = <T>(value: T): T => structuredClone(value);
const sentinel = "GENERATED_PRIVATE_PROVIDER_VALUE";

function firstVersion<T>(versions: readonly T[]): T {
  const version = versions[0];
  assert.ok(version !== undefined, "SyntheticMarkerVersionMissing");
  return version;
}

function fixture() {
  const target = {
    bucketName: "synthetic-completion-metadata",
    expectedBucketOwner: "123456789012",
    key: "candidate-deletion-recovery/11111111-1111-4111-8111-111111111111.json",
    versionId: "synthetic-selected-version",
  };
  const kmsKeyArn = "arn:aws:kms:us-east-2:123456789012:key/33333333-3333-4333-8333-333333333333";
  const body = Buffer.from("generated synthetic marker bytes\n", "utf8");
  const metadata = {
    "request-id": "11111111-1111-4111-8111-111111111111",
    "operation-id": "22222222-2222-4222-8222-222222222222",
    "policy-version": "d1-development-synthetic-v1",
    "policy-sha256": "a".repeat(64),
    "subject-digest": "b".repeat(64),
    "confirmed-at": "2026-08-25T15:00:00.000Z",
    "backup-expires-at": "2026-09-29T15:00:00.000Z",
    format: "candidate-deletion-recovery-v1",
  };
  const rawVersion = {
    Key: target.key,
    VersionId: target.versionId,
    IsLatest: true,
    ETag: '"synthetic-etag"',
    Size: body.byteLength,
    LastModified: new Date("2026-08-25T15:00:00.000Z"),
    StorageClass: "STANDARD",
    Owner: { ID: "c".repeat(64) },
    ChecksumAlgorithm: ["SHA256"],
    ChecksumType: "FULL_OBJECT",
  };
  const listing = {
    $metadata: { httpStatusCode: 200, requestId: "synthetic-request" },
    Name: target.bucketName,
    Prefix: target.key,
    MaxKeys: 2,
    IsTruncated: false,
    KeyMarker: "",
    VersionIdMarker: "",
    Versions: [rawVersion],
    DeleteMarkers: [],
    CommonPrefixes: [],
  };
  const head = {
    $metadata: { httpStatusCode: 200, requestId: "synthetic-head-request" },
    VersionId: target.versionId,
    ETag: rawVersion.ETag,
    LastModified: rawVersion.LastModified,
    ContentLength: body.byteLength,
    ContentType: "application/json",
    AcceptRanges: "bytes",
    ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
    ChecksumType: "FULL_OBJECT",
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: kmsKeyArn,
    BucketKeyEnabled: true,
    ObjectLockMode: "COMPLIANCE",
    ObjectLockRetainUntilDate: new Date(metadata["backup-expires-at"]),
    ObjectLockLegalHoldStatus: "OFF",
    Metadata: metadata,
  };
  const tagging = {
    $metadata: { httpStatusCode: 200 },
    VersionId: target.versionId,
    TagSet: [
      { Key: "state", Value: "completed" },
      { Key: "completed-at", Value: "2026-08-25T15:05:00.000Z" },
    ],
  };
  const retention = {
    $metadata: { httpStatusCode: 200 },
    Retention: { Mode: "COMPLIANCE", RetainUntilDate: new Date(metadata["backup-expires-at"]) },
  };
  const evidence: CompletionMarkerAwsEvidence = {
    target,
    expectedKmsKeyArn: kmsKeyArn,
    object: clone(head),
    tagging: clone(tagging),
    retention: clone(retention),
    version: completionMarkerVersionFromListing(target, listing),
  };
  const state = {
    commands: [] as { kind: string; input: unknown }[],
    configurations: [] as unknown[],
    signals: [] as AbortSignal[],
    destroys: 0,
    lists: 0,
    head: clone(head) as unknown,
    tagging: clone(tagging) as unknown,
    retention: clone(retention) as unknown,
    listing: clone(listing) as unknown,
    onSend: undefined as
      | ((kind: string, ordinal: number) => unknown | Promise<unknown>)
      | undefined,
  };
  class Command {
    readonly input: unknown;
    readonly kind: string;
    constructor(input: unknown, kind: string) {
      this.input = clone(input);
      this.kind = kind;
    }
  }
  class HeadObjectCommand extends Command {
    constructor(input: unknown) {
      super(input, "head");
    }
  }
  class GetObjectTaggingCommand extends Command {
    constructor(input: unknown) {
      super(input, "tags");
    }
  }
  class GetObjectRetentionCommand extends Command {
    constructor(input: unknown) {
      super(input, "retention");
    }
  }
  class ListObjectVersionsCommand extends Command {
    constructor(input: unknown) {
      super(input, "versions");
    }
  }
  class S3Client {
    constructor(configuration: unknown) {
      state.configurations.push(configuration);
    }
    async send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown> {
      assert.ok(command instanceof Command);
      assert.ok(options?.abortSignal instanceof AbortSignal);
      state.signals.push(options.abortSignal);
      state.commands.push({ kind: command.kind, input: clone(command.input) });
      if (state.onSend) return state.onSend(command.kind, state.commands.length);
      if (command.kind === "versions") {
        state.lists++;
        return clone(state.listing);
      }
      if (command.kind === "head") return clone(state.head);
      if (command.kind === "tags") return clone(state.tagging);
      if (command.kind === "retention") return clone(state.retention);
      throw new Error("UnexpectedAction");
    }
    destroy() {
      state.destroys++;
    }
  }
  const sdk = {
    S3Client,
    HeadObjectCommand,
    GetObjectTaggingCommand,
    GetObjectRetentionCommand,
    ListObjectVersionsCommand,
  };
  return {
    target,
    kmsKeyArn,
    body,
    listing,
    head,
    tagging,
    retention,
    evidence,
    state,
    sdk,
    reader: createCompletionMarkerS3Reader(sdk, kmsKeyArn),
  };
}

function refused(callback: () => unknown) {
  assert.throws(callback, { message: "HistoricalCompletionMarkerMetadataRejected" });
}

test("HEAD and independently body-verified GetObject metadata yield identical private fingerprints", () => {
  const f = fixture();
  let bodyReads = 0;
  const get = {
    ...clone(f.head),
    Body: {
      async *[Symbol.asyncIterator]() {
        bodyReads++;
        yield f.body;
      },
    },
  };
  const left = completionMarkerObservationFromAws(f.evidence);
  const right = completionMarkerObservationFromAws({ ...f.evidence, object: get });
  assert.deepEqual(left, right);
  assert.equal(left.bodySha256, createHash("sha256").update(f.body).digest("hex"));
  assert.equal(left.checksumSha256, left.bodySha256);
  assert.equal(bodyReads, 0);
  assert.deepEqual(
    Object.keys(left).sort(),
    [
      "bodySha256",
      "bucketName",
      "checksumSha256",
      "contentLength",
      "encryptionSha256",
      "etag",
      "expectedBucketOwner",
      "key",
      "lastModified",
      "metadataSha256",
      "retentionSha256",
      "tagSet",
      "versionId",
      "versionInventorySha256",
    ].sort(),
  );
});

test("optional GetObject/HEAD checksum-type omission is representation only, never a fabricated observation", () => {
  const f = fixture();
  const missing = clone(f.head) as Record<string, unknown>;
  delete missing.ChecksumType;
  assert.deepEqual(
    completionMarkerObservationFromAws({ ...f.evidence, object: missing }),
    completionMarkerObservationFromAws(f.evidence),
  );
  assert.equal(Object.hasOwn(missing, "ChecksumType"), false);
});

test("same-API list checksum presence remains in the inventory fingerprint", () => {
  const f = fixture();
  const original = f.evidence.version;
  const listing = clone(f.listing) as { Versions: Record<string, unknown>[] };
  delete listing.Versions[0]?.ChecksumType;
  delete listing.Versions[0]?.ChecksumAlgorithm;
  const absent = completionMarkerVersionFromListing(f.target, listing);
  assert.equal(absent.checksumType, null);
  assert.equal(absent.checksumAlgorithm, null);
  assert.notEqual(
    completionMarkerVersionFingerprint(f.target, original),
    completionMarkerVersionFingerprint(f.target, absent),
  );
});

test("missing legal-hold visibility remains distinct from observed OFF", () => {
  const f = fixture();
  const missing = clone(f.head) as Record<string, unknown>;
  delete missing.ObjectLockLegalHoldStatus;
  assert.notEqual(
    completionMarkerObservationFromAws({ ...f.evidence, object: missing }).retentionSha256,
    completionMarkerObservationFromAws(f.evidence).retentionSha256,
  );
});

test("metadata and tag ordering do not change fingerprints, but values do", () => {
  const f = fixture();
  const head = {
    ...clone(f.head),
    Metadata: Object.fromEntries(Object.entries(f.head.Metadata).reverse()),
  };
  const tagging = { ...clone(f.tagging), TagSet: clone(f.tagging.TagSet).reverse() };
  assert.deepEqual(
    completionMarkerObservationFromAws({ ...f.evidence, object: head, tagging }),
    completionMarkerObservationFromAws(f.evidence),
  );
  head.Metadata["subject-digest"] = "9".repeat(64);
  assert.notEqual(
    completionMarkerObservationFromAws({ ...f.evidence, object: head }).metadataSha256,
    completionMarkerObservationFromAws(f.evidence).metadataSha256,
  );
});

const invalidObject: [string, (row: Record<string, unknown>) => void][] = [
  [
    "unknown-field",
    (r) => {
      r.unreviewed = sentinel;
    },
  ],
  [
    "http-status",
    (r) => {
      r.$metadata = { httpStatusCode: 403 };
    },
  ],
  [
    "missing-http-status",
    (r) => {
      delete r.$metadata;
    },
  ],
  [
    "version",
    (r) => {
      r.VersionId = "other";
    },
  ],
  [
    "etag",
    (r) => {
      r.ETag = '"other"';
    },
  ],
  [
    "length",
    (r) => {
      r.ContentLength = 100;
    },
  ],
  [
    "last-modified",
    (r) => {
      r.LastModified = new Date("2026-08-25T15:01:00.000Z");
    },
  ],
  [
    "date-string-in-SDK-response",
    (r) => {
      r.LastModified = "2026-08-25T15:00:00.000Z";
    },
  ],
  [
    "delete-marker",
    (r) => {
      r.DeleteMarker = true;
    },
  ],
  [
    "encryption",
    (r) => {
      r.ServerSideEncryption = "AES256";
    },
  ],
  [
    "kms",
    (r) => {
      r.SSEKMSKeyId = "different";
    },
  ],
  [
    "bucket-key",
    (r) => {
      r.BucketKeyEnabled = false;
    },
  ],
  [
    "content-type",
    (r) => {
      r.ContentType = "text/plain";
    },
  ],
  [
    "composite-checksum",
    (r) => {
      r.ChecksumType = "COMPOSITE";
    },
  ],
  [
    "unknown-checksum-kind",
    (r) => {
      r.ChecksumType = "UNKNOWN";
    },
  ],
  [
    "missing-sha",
    (r) => {
      delete r.ChecksumSHA256;
    },
  ],
  [
    "bad-sha-encoding",
    (r) => {
      r.ChecksumSHA256 = "invalid";
    },
  ],
  [
    "multipart-sha-suffix",
    (r) => {
      r.ChecksumSHA256 = `${r.ChecksumSHA256}-2`;
    },
  ],
  [
    "short-checksum",
    (r) => {
      r.ChecksumSHA256 = Buffer.alloc(31).toString("base64");
    },
  ],
  [
    "noncanonical-base64-padbits",
    (r) => {
      r.ChecksumSHA256 = `${"A".repeat(42)}B=`;
    },
  ],
  [
    "content-encoding",
    (r) => {
      r.ContentEncoding = "gzip";
    },
  ],
  [
    "content-range",
    (r) => {
      r.ContentRange = "bytes 0-2/9";
    },
  ],
  [
    "missing-metadata",
    (r) => {
      r.MissingMeta = 1;
    },
  ],
  [
    "archive",
    (r) => {
      r.StorageClass = "GLACIER";
    },
  ],
  [
    "parts",
    (r) => {
      r.PartsCount = 2;
    },
  ],
  [
    "tag-count",
    (r) => {
      r.TagCount = 3;
    },
  ],
  [
    "sse-customer",
    (r) => {
      r.SSECustomerAlgorithm = "AES256";
    },
  ],
  [
    "retention-mode",
    (r) => {
      r.ObjectLockMode = "GOVERNANCE";
    },
  ],
  [
    "retention-time",
    (r) => {
      r.ObjectLockRetainUntilDate = new Date("2026-09-30T15:00:00.000Z");
    },
  ],
  [
    "legal-hold",
    (r) => {
      r.ObjectLockLegalHoldStatus = "ON";
    },
  ],
  [
    "unknown-legal-hold",
    (r) => {
      r.ObjectLockLegalHoldStatus = "UNKNOWN";
    },
  ],
  [
    "extra-user-metadata",
    (r) => {
      (r.Metadata as Record<string, unknown>).extra = sentinel;
    },
  ],
  [
    "wrong-request-metadata",
    (r) => {
      (r.Metadata as Record<string, unknown>)["request-id"] =
        "22222222-2222-4222-8222-222222222222";
    },
  ],
  [
    "missing-operation-metadata",
    (r) => {
      delete (r.Metadata as Record<string, unknown>)["operation-id"];
    },
  ],
  [
    "policy-digest",
    (r) => {
      (r.Metadata as Record<string, unknown>)["policy-sha256"] = "invalid";
    },
  ],
  [
    "confirmation-date",
    (r) => {
      (r.Metadata as Record<string, unknown>)["confirmed-at"] = "not-a-date";
    },
  ],
  [
    "expired-before-confirmation",
    (r) => {
      (r.Metadata as Record<string, unknown>)["backup-expires-at"] = "2026-08-20T15:00:00.000Z";
    },
  ],
];
for (const [name, change] of invalidObject) {
  test(`rejects malformed object ${name} without returning raw values`, () => {
    const f = fixture();
    const row = clone(f.head) as Record<string, unknown>;
    change(row);
    refused(() => completionMarkerObservationFromAws({ ...f.evidence, object: row }));
  });
}

const invalidList: [string, (row: Record<string, unknown>) => void][] = [
  [
    "unknown-field",
    (r) => {
      r.unreviewed = true;
    },
  ],
  [
    "wrong-bucket",
    (r) => {
      r.Name = "different";
    },
  ],
  [
    "broad-prefix",
    (r) => {
      r.Prefix = "candidate-deletion-recovery/";
    },
  ],
  [
    "wrong-limit",
    (r) => {
      r.MaxKeys = 100;
    },
  ],
  [
    "truncated",
    (r) => {
      r.IsTruncated = true;
      r.NextKeyMarker = "next";
    },
  ],
  [
    "cursor",
    (r) => {
      r.KeyMarker = "prior";
    },
  ],
  [
    "extra-version",
    (r) => {
      r.Versions = [...(r.Versions as unknown[]), ...(r.Versions as unknown[])];
    },
  ],
  [
    "missing-version",
    (r) => {
      r.Versions = [];
    },
  ],
  [
    "delete-marker",
    (r) => {
      r.DeleteMarkers = [{ Key: "other" }];
    },
  ],
  [
    "common-prefix",
    (r) => {
      r.CommonPrefixes = [{ Prefix: "other" }];
    },
  ],
  [
    "encoded-keys",
    (r) => {
      r.EncodingType = "url";
    },
  ],
  [
    "not-latest",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).IsLatest = false;
    },
  ],
  [
    "wrong-key",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).Key = "another-key";
    },
  ],
  [
    "wrong-version",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).VersionId = "other";
    },
  ],
  [
    "archive",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).StorageClass = "GLACIER";
    },
  ],
  [
    "restore-status",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).RestoreStatus = {};
    },
  ],
  [
    "checksum-algorithm",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).ChecksumAlgorithm = ["SHA1"];
    },
  ],
  [
    "checksum-composite",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).ChecksumType = "COMPOSITE";
    },
  ],
  [
    "malformed-owner",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).Owner = { ID: "invalid" };
    },
  ],
  [
    "oversized-marker",
    (r) => {
      firstVersion(r.Versions as Record<string, unknown>[]).Size = 16385;
    },
  ],
];
for (const [name, change] of invalidList) {
  test(`rejects listing ${name} with no pagination`, () => {
    const f = fixture();
    const row = clone(f.listing) as Record<string, unknown>;
    change(row);
    refused(() => completionMarkerVersionFromListing(f.target, row));
  });
}

test("exact two-tag shape/version, retention tuple and expected KMS are mandatory", () => {
  const f = fixture();
  const variants: Partial<CompletionMarkerAwsEvidence>[] = [
    {
      expectedKmsKeyArn:
        "arn:aws:kms:us-east-1:123456789012:key/33333333-3333-4333-8333-333333333333",
    },
    { tagging: { ...f.tagging, VersionId: "other" } },
    {
      tagging: { ...f.tagging, TagSet: [...f.tagging.TagSet, { Key: "extra", Value: "preserve" }] },
    },
    { tagging: { ...f.tagging, TagSet: [f.tagging.TagSet[0], f.tagging.TagSet[0]] } },
    {
      tagging: { ...f.tagging, TagSet: [{ Key: "state", Value: "pending" }, f.tagging.TagSet[1]] },
    },
    {
      tagging: {
        ...f.tagging,
        TagSet: [
          { Key: "state", Value: "completed" },
          { Key: "completed-at", Value: "2026-08-24T15:05:00.000Z" },
        ],
      },
    },
    { retention: { ...f.retention, Retention: { ...f.retention.Retention, Mode: "GOVERNANCE" } } },
    {
      retention: {
        ...f.retention,
        Retention: {
          ...f.retention.Retention,
          RetainUntilDate: new Date("2026-09-30T15:00:00.000Z"),
        },
      },
    },
    { retention: { ...f.retention, Retention: { ...f.retention.Retention, extra: true } } },
  ];
  for (const change of variants)
    refused(() => completionMarkerObservationFromAws({ ...f.evidence, ...change }));
});

test("only five fixed read operations run with exact owner/version/region/endpoint and whole-deadline signals", async () => {
  const f = fixture();
  const observed = await f.reader.readExactVersion(f.target);
  assert.deepEqual(observed, completionMarkerObservationFromAws(f.evidence));
  assert.deepEqual(
    f.state.commands.map(({ kind }) => kind),
    ["versions", "head", "tags", "retention", "versions"],
  );
  assert.deepEqual(f.state.configurations, [COMPLETION_REPAIR_S3_CONFIGURATION]);
  assert.equal(f.state.destroys, 1);
  assert.equal(new Set(f.state.signals).size, 1);
  assert.equal(f.state.signals[0]?.aborted, true);
  for (const command of f.state.commands) {
    const common = {
      Bucket: f.target.bucketName,
      ExpectedBucketOwner: f.target.expectedBucketOwner,
    };
    assert.deepEqual(
      command.input,
      command.kind === "versions"
        ? { ...common, Prefix: f.target.key, MaxKeys: 2 }
        : {
            ...common,
            Key: f.target.key,
            VersionId: f.target.versionId,
            ...(command.kind === "head" ? { ChecksumMode: "ENABLED" } : {}),
          },
    );
  }
});

test("changed final version inventory refuses instead of returning a stale observation", async () => {
  const f = fixture();
  f.state.onSend = (kind, ordinal) => {
    if (kind === "head") return clone(f.head);
    if (kind === "tags") return clone(f.tagging);
    if (kind === "retention") return clone(f.retention);
    const listing = clone(f.listing);
    if (ordinal === 5) firstVersion(listing.Versions).Owner.ID = "d".repeat(64);
    return listing;
  };
  await assert.rejects(f.reader.readExactVersion(f.target), {
    message: "HistoricalCompletionMarkerReadRejected",
  });
  assert.equal(f.state.commands.length, 5);
  assert.equal(f.state.destroys, 1);
});

test("invalid initial inventory stops after one fixed listing with no retry", async () => {
  const f = fixture();
  (f.state.listing as { IsTruncated: boolean }).IsTruncated = true;
  await assert.rejects(f.reader.readExactVersion(f.target), {
    message: "HistoricalCompletionMarkerReadRejected",
  });
  assert.equal(f.state.commands.length, 1);
  assert.equal(f.state.destroys, 1);
});

test("never-settling reads hit the finite whole deadline and issue no late commands", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = fixture();
  f.state.onSend = () => new Promise(() => {});
  const pending = f.reader.readExactVersion(f.target);
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.advanceTimersByTime(COMPLETION_MARKER_READ_TIMEOUT_MS);
  await assert.rejects(pending, { message: "HistoricalCompletionMarkerReadRejected" });
  assert.equal(f.state.commands.length, 1);
  assert.equal(f.state.signals[0]?.aborted, true);
  assert.equal(f.state.destroys, 1);
  vi.advanceTimersByTime(COMPLETION_MARKER_READ_TIMEOUT_MS * 5);
  assert.equal(f.state.commands.length, 1);
});

test("the whole deadline is not restarted for each individual metadata request", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = fixture();
  f.state.onSend = (kind) =>
    new Promise((resolve) =>
      setTimeout(() => {
        resolve(
          clone(
            kind === "versions"
              ? f.listing
              : kind === "head"
                ? f.head
                : kind === "tags"
                  ? f.tagging
                  : f.retention,
          ),
        );
      }, 8_000),
    );
  const pending = f.reader.readExactVersion(f.target);
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let index = 0; index < 3; index++) {
    vi.advanceTimersByTime(8_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  vi.advanceTimersByTime(6_000);
  await assert.rejects(pending, { message: "HistoricalCompletionMarkerReadRejected" });
  assert.equal(f.state.commands.length, 4);
  assert.equal(f.state.destroys, 1);
  vi.advanceTimersByTime(30_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.commands.length, 4);
});

test("pre-aborted and malformed external signals cannot create a client", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.reader.readExactVersion(f.target, controller.signal), {
    message: "HistoricalCompletionMarkerReadRejected",
  });
  await assert.rejects(
    f.reader.readExactVersion(f.target, {
      removeEventListener() {
        throw new Error(sentinel);
      },
    } as unknown as AbortSignal),
    { message: "HistoricalCompletionMarkerReadRejected" },
  );
  assert.equal(f.state.configurations.length, 0);
  assert.equal(f.state.commands.length, 0);
});

test("external cancellation and raw provider errors produce fixed classes only", async () => {
  const f = fixture();
  const external = new AbortController();
  f.state.onSend = () =>
    new Promise((_resolve, reject) => {
      f.state.signals[0]?.addEventListener("abort", () => reject(new Error(sentinel)), {
        once: true,
      });
    });
  const pending = f.reader.readExactVersion(f.target, external.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  external.abort();
  await assert.rejects(pending, { message: "HistoricalCompletionMarkerReadRejected" });
  assert.equal(f.state.commands.length, 1);
  assert.equal(f.state.destroys, 1);
});

test("hostile metadata accessors and proxies cannot leak their error or consume a body", () => {
  const f = fixture();
  let reads = 0;
  const hostile = Object.defineProperty({}, "Metadata", {
    get() {
      reads++;
      throw new Error(sentinel);
    },
  });
  refused(() => completionMarkerObservationFromAws({ ...f.evidence, object: hostile }));
  assert.equal(reads, 0);
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  refused(() => completionMarkerObservationFromAws({ ...f.evidence, object: proxy }));
});
