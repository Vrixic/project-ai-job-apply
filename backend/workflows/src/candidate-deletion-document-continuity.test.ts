import { afterEach, describe, expect, it, vi } from "vitest";
import { AwsReadOnlyCandidateRestoreDocuments } from "./candidate-deletion-restore-aws.js";

type Row = Record<string, unknown>;
const issuedAt = "2026-09-01T00:00:00.000Z";
const bucketName = "synthetic-private-documents";
const expectedBucketOwner = "123456789012";
const error = "CandidateDeletionRestoreCloudInspectionRejected";
const old = () => ({
  Key: "quarantine/synthetic/source",
  VersionId: "synthetic-private-version",
  IsLatest: true,
  LastModified: new Date("2026-08-31T23:59:59.000Z"),
});

function setup(change: (output: Row, input: Row) => Row = (output) => output) {
  const send = vi.fn(async (command: unknown) => {
    const typed = command as { constructor: { name: string }; input: Row };
    expect(typed.constructor.name).toBe("ListObjectVersionsCommand");
    expect(typed.input).toMatchObject({
      Bucket: bucketName,
      ExpectedBucketOwner: expectedBucketOwner,
      MaxKeys: 100,
    });
    return change(
      {
        Name: bucketName,
        Prefix: typed.input.Prefix,
        MaxKeys: 100,
        KeyMarker: typed.input.KeyMarker ?? "",
        VersionIdMarker: typed.input.VersionIdMarker ?? "",
        IsTruncated: false,
        Versions: typed.input.Prefix === "quarantine/" ? [old()] : [],
        DeleteMarkers: [],
      },
      typed.input,
    );
  });
  return {
    send,
    documents: new AwsReadOnlyCandidateRestoreDocuments({
      bucketName,
      expectedBucketOwner,
      s3: { send },
      timeoutMs: 100,
    }),
  };
}

afterEach(() => vi.useRealTimers());

describe("historical replay document continuity", () => {
  it("checks both complete namespaces using metadata only and emits no locators", async () => {
    const h = setup();
    const result = await h.documents.inspectReplayDocumentContinuity(issuedAt);
    expect(result).toEqual({
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      versionsObserved: 1,
    });
    expect(h.send.mock.calls).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/synthetic|quarantine|normalized|source/u);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each(["Versions", "DeleteMarkers"])("rejects new or boundary-tied %s", async (kind) => {
    for (const stamp of [issuedAt, "2026-09-01T00:00:00.001Z"]) {
      const h = setup((output) => ({
        ...output,
        Versions: [],
        [kind]: [{ ...old(), LastModified: new Date(stamp) }],
      }));
      await expect(h.documents.inspectReplayDocumentContinuity(issuedAt)).rejects.toThrow(error);
    }
  });

  it("includes old delete markers and historical nonlatest versions in the digest", async () => {
    const first = await setup().documents.inspectReplayDocumentContinuity(issuedAt);
    const deletion = await setup((output, input) =>
      input.Prefix === "quarantine/" ? { ...output, Versions: [], DeleteMarkers: [old()] } : output,
    ).documents.inspectReplayDocumentContinuity(issuedAt);
    const historical = await setup((output, input) =>
      input.Prefix === "quarantine/"
        ? { ...output, Versions: [{ ...old(), IsLatest: false }] }
        : output,
    ).documents.inspectReplayDocumentContinuity(issuedAt);
    expect(new Set([first.sha256, deletion.sha256, historical.sha256]).size).toBe(3);
  });

  it("fully paginates and hashes in stable order", async () => {
    const second = { ...old(), Key: "quarantine/another/source", VersionId: "another-version" };
    const h = setup((output, input) => {
      if (input.Prefix !== "quarantine/") return output;
      if (!input.KeyMarker)
        return {
          ...output,
          IsTruncated: true,
          NextKeyMarker: old().Key,
          NextVersionIdMarker: old().VersionId,
        };
      expect(input.VersionIdMarker).toBe(old().VersionId);
      return { ...output, Versions: [second] };
    });
    const paged = await h.documents.inspectReplayDocumentContinuity(issuedAt);
    const unpaged = await setup((output, input) =>
      input.Prefix === "quarantine/" ? { ...output, Versions: [second, old()] } : output,
    ).documents.inspectReplayDocumentContinuity(issuedAt);
    expect(paged).toEqual(unpaged);
    expect(h.send).toHaveBeenCalledTimes(3);
  });

  it.each([
    "foreign-prefix",
    "bad-date",
    "string-date",
    "null-version",
    "duplicate",
    "duplicate-kind",
    "no-latest",
    "wrong-bucket",
    "wrong-page-size",
    "dangling-cursor",
    "empty-truncated",
    "bad-cursor",
    "oversized-page",
  ])("rejects %s", async (fault) => {
    const h = setup((output) => {
      const item: Row = old();
      if (fault === "foreign-prefix") item.Key = "private/other";
      if (fault === "bad-date") item.LastModified = new Date(Number.NaN);
      if (fault === "string-date") item.LastModified = "2026-08-31T23:59:59.000Z";
      if (fault === "null-version") item.VersionId = "null";
      if (fault === "no-latest") delete item.IsLatest;
      if (fault === "wrong-bucket") return { ...output, Name: "foreign-bucket" };
      if (fault === "wrong-page-size") return { ...output, MaxKeys: 101 };
      if (fault === "dangling-cursor") return { ...output, NextKeyMarker: item.Key };
      if (fault === "empty-truncated")
        return { ...output, Versions: [], IsTruncated: true, NextKeyMarker: item.Key };
      if (fault === "bad-cursor")
        return { ...output, IsTruncated: true, NextKeyMarker: "foreign/key" };
      if (fault === "oversized-page")
        return { ...output, Versions: Array.from({ length: 101 }, () => item) };
      return {
        ...output,
        Versions: fault === "duplicate" ? [item, item] : [item],
        DeleteMarkers: fault === "duplicate-kind" ? [item] : [],
      };
    });
    await expect(h.documents.inspectReplayDocumentContinuity(issuedAt)).rejects.toThrow(error);
  });

  it("rejects a repeated cursor and bounds small-page pagination", async () => {
    vi.useFakeTimers();
    for (const repeated of [true, false]) {
      let index = 0;
      const h = setup((output, input) => {
        index += 1;
        return {
          ...output,
          Versions: [{ ...old(), Key: `${input.Prefix}${index}`, VersionId: `${index}` }],
          IsTruncated: true,
          NextKeyMarker: repeated ? "quarantine/repeated" : `${input.Prefix}${index}`,
          NextVersionIdMarker: repeated ? "same" : `${index}`,
        };
      });
      await expect(h.documents.inspectReplayDocumentContinuity(issuedAt)).rejects.toThrow(error);
      expect(h.send.mock.calls.length).toBe(repeated ? 2 : 101);
    }
  });

  it("bounds total observations across both namespaces", async () => {
    vi.useFakeTimers();
    let index = 0;
    const h = setup((output, input) => {
      const start = index;
      index += 100;
      const versions = Array.from({ length: 100 }, (_, i) => ({
        ...old(),
        Key: `${input.Prefix}${start + i}`,
        VersionId: `${start + i}`,
      }));
      return {
        ...output,
        Versions: versions,
        IsTruncated: input.Prefix === "quarantine/" && index < 10_000,
        ...(input.Prefix === "quarantine/" && index < 10_000
          ? {
              NextKeyMarker: `${input.Prefix}${index}`,
              NextVersionIdMarker: `${index}`,
            }
          : {}),
      };
    });
    await expect(h.documents.inspectReplayDocumentContinuity(issuedAt)).rejects.toThrow(error);
    expect(h.send).toHaveBeenCalledTimes(101);
  });

  it.each([
    "2026-09-01T00:00:00Z",
    "not-a-date",
    "1970-01-01T00:00:00.000Z",
    "2999-01-01T00:00:00.000Z",
  ])("rejects invalid issuance %s before cloud calls", async (cutoff) => {
    const h = setup();
    await expect(h.documents.inspectReplayDocumentContinuity(cutoff)).rejects.toThrow(error);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("honors pre-abort and a stuck SDK deadline without exposing SDK errors", async () => {
    const h = setup();
    await expect(
      h.documents.inspectReplayDocumentContinuity(issuedAt, AbortSignal.abort()),
    ).rejects.toThrow(error);
    expect(h.send).not.toHaveBeenCalled();
    vi.useFakeTimers();
    h.send.mockImplementationOnce(() => new Promise(() => undefined));
    const refused = expect(h.documents.inspectReplayDocumentContinuity(issuedAt)).rejects.toThrow(
      error,
    );
    await vi.advanceTimersByTimeAsync(101);
    await refused;
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});
