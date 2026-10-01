import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  AwsCandidateDocumentObjectStore,
  AwsCandidateExportArtifactStore,
} from "./candidate-rights-aws.js";

function commandInput(command: unknown): Record<string, unknown> {
  if (!command || typeof command !== "object" || !("input" in command)) {
    throw new Error("Expected AWS command input");
  }
  return (command as { input: Record<string, unknown> }).input;
}

const exportKey = "candidate-data-exports/user/export.json";

interface LocalS3Request {
  method: string;
  path: string;
  query?: unknown;
  body?: unknown;
}

function s3Response(statusCode: number, headers: Record<string, string> = {}) {
  return { response: { statusCode, headers, body: new Uint8Array() } };
}

function localS3Client(
  handle: (request: LocalS3Request) => Promise<ReturnType<typeof s3Response>>,
) {
  return new S3Client({
    region: "us-east-2",
    endpoint: "https://s3.synthetic.invalid",
    forcePathStyle: true,
    credentials: { accessKeyId: "synthetic-local-only", secretAccessKey: "synthetic-local-only" },
    maxAttempts: 1,
    requestHandler: { handle },
  });
}

describe("candidate-rights AWS object boundaries", () => {
  it("writes one checksum/KMS/version-bound export artifact", async () => {
    const send = vi.fn(async (_command: unknown) => ({ VersionId: "exact-version" }));
    const store = new AwsCandidateExportArtifactStore(
      "synthetic-export-bucket",
      "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
      { send },
    );

    await expect(
      store.putIfAbsent({
        objectKey: "candidate-data-exports/user/export.json",
        body: new TextEncoder().encode("{}\n"),
        sha256: "a".repeat(64),
        expiresAt: new Date("2026-08-25T13:00:00.000Z"),
      }),
    ).resolves.toEqual({ objectVersion: "exact-version" });

    expect(send).toHaveBeenCalledOnce();
    expect(commandInput(send.mock.calls[0]?.[0])).toMatchObject({
      Bucket: "synthetic-export-bucket",
      Key: "candidate-data-exports/user/export.json",
      ServerSideEncryption: "aws:kms",
      ChecksumAlgorithm: "SHA256",
      IfNoneMatch: "*",
      Metadata: {
        sha256: "a".repeat(64),
        "expires-at": "2026-08-25T13:00:00.000Z",
        format: "candidate-data-export-v1",
      },
    });
  });

  it("accepts only an exact pre-existing artifact on an ambiguous retry", async () => {
    const conflict = Object.assign(new Error("conflict"), {
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        VersionId: "retained-version",
        Metadata: {
          sha256: "b".repeat(64),
          "expires-at": "2026-08-25T13:00:00.000Z",
          format: "candidate-data-export-v1",
        },
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
      });
    const store = new AwsCandidateExportArtifactStore(
      "synthetic-export-bucket",
      "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
      { send },
    );

    await expect(
      store.putIfAbsent({
        objectKey: "candidate-data-exports/user/export.json",
        body: new Uint8Array([1]),
        sha256: "b".repeat(64),
        expiresAt: new Date("2026-08-25T13:00:00.000Z"),
      }),
    ).resolves.toEqual({ objectVersion: "retained-version" });
  });

  it.each([undefined, false])(
    "accepts only an exact positive export deletion acknowledgment (%s)",
    async (deleteMarker) => {
      const send = vi.fn().mockResolvedValue({
        $metadata: { httpStatusCode: 204 },
        VersionId: "exact-expired-version",
        ...(deleteMarker === undefined ? {} : { DeleteMarker: deleteMarker }),
      });
      const store = new AwsCandidateExportArtifactStore(
        "synthetic-export-bucket",
        "synthetic-kms-key",
        { send },
      );
      await expect(store.deleteExactVersion(exportKey, "exact-expired-version")).resolves.toBe(
        true,
      );
      expect(send).toHaveBeenCalledOnce();
      expect(
        send.mock.calls.map(([command]) => ({
          name: (command as { constructor: { name: string } }).constructor.name,
          input: commandInput(command),
        })),
      ).toEqual([
        {
          name: "DeleteObjectCommand",
          input: {
            Bucket: "synthetic-export-bucket",
            Key: exportKey,
            VersionId: "exact-expired-version",
          },
        },
      ]);
    },
  );

  it.each([undefined, null, "", 0, false, {}, [], new Date("2026-09-10T00:00:00.000Z")])(
    "rejects invalid export identities before issuing a command (%j)",
    async (invalid) => {
      const send = vi.fn();
      const store = new AwsCandidateExportArtifactStore(
        "synthetic-export-bucket",
        "synthetic-kms-key",
        { send },
      );
      await expect(
        store.deleteExactVersion(invalid as string, "exact-expired-version"),
      ).rejects.toThrow("CandidateExportArtifactIdentityRejected");
      await expect(store.deleteExactVersion(exportKey, invalid as string)).rejects.toThrow(
        "CandidateExportArtifactIdentityRejected",
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("rejects the unversioned literal null version before sending", async () => {
    const send = vi.fn();
    const store = new AwsCandidateExportArtifactStore(
      "synthetic-export-bucket",
      "synthetic-kms-key",
      { send },
    );
    await expect(store.deleteExactVersion(exportKey, "null")).rejects.toThrow(
      "CandidateExportArtifactIdentityRejected",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { label: "no acknowledgment", output: {} },
    { label: "missing metadata", output: { VersionId: "exact-expired-version" } },
    { label: "missing status", output: { $metadata: {}, VersionId: "exact-expired-version" } },
    {
      label: "string status",
      output: { $metadata: { httpStatusCode: "204" }, VersionId: "exact-expired-version" },
    },
    {
      label: "unexpected success status",
      output: { $metadata: { httpStatusCode: 200 }, VersionId: "exact-expired-version" },
    },
    { label: "missing version", output: { $metadata: { httpStatusCode: 204 } } },
    { label: "empty version", output: { $metadata: { httpStatusCode: 204 }, VersionId: "" } },
    {
      label: "wrong version",
      output: { $metadata: { httpStatusCode: 204 }, VersionId: "different-version" },
    },
    {
      label: "literal null version",
      output: { $metadata: { httpStatusCode: 204 }, VersionId: "null" },
    },
    {
      label: "created or deleted marker",
      output: {
        $metadata: { httpStatusCode: 204 },
        VersionId: "exact-expired-version",
        DeleteMarker: true,
      },
    },
    {
      label: "malformed marker",
      output: {
        $metadata: { httpStatusCode: 204 },
        VersionId: "exact-expired-version",
        DeleteMarker: "false",
      },
    },
    {
      label: "null marker",
      output: {
        $metadata: { httpStatusCode: 204 },
        VersionId: "exact-expired-version",
        DeleteMarker: null,
      },
    },
  ])("rejects ambiguous DELETE output: $label", async ({ output }) => {
    const send = vi.fn().mockResolvedValue(output);
    const store = new AwsCandidateExportArtifactStore(
      "synthetic-export-bucket",
      "synthetic-kms-key",
      { send },
    );
    await expect(store.deleteExactVersion(exportKey, "exact-expired-version")).rejects.toThrow(
      "CandidateExportArtifactDeletionUnconfirmed",
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "AccessDenied", status: 403 },
    { name: "UnknownError", status: 403 },
    { name: "NotFound", status: 404 },
    { name: "NoSuchKey", status: 404 },
    { name: "NoSuchVersion", status: 404 },
    { name: "InternalError", status: 500 },
    { name: "TimeoutError", status: undefined },
  ])("never treats a rejected DELETE as absence: $name", async ({ name, status }) => {
    const error = Object.assign(new Error("synthetic deletion failure"), {
      name,
      $metadata: { httpStatusCode: status },
    });
    const send = vi.fn().mockRejectedValue(error);
    const store = new AwsCandidateExportArtifactStore(
      "synthetic-export-bucket",
      "synthetic-kms-key",
      { send },
    );
    await expect(store.deleteExactVersion(exportKey, "exact-expired-version")).rejects.toBe(error);
    expect(send).toHaveBeenCalledOnce();
  });

  it("uses real SDK metadata without the HEAD that returns an ambiguous 403", async () => {
    const version = "version/with+opaque=characters";
    const handle = vi.fn(async (request: LocalS3Request) =>
      request.method === "DELETE"
        ? s3Response(204, { "x-amz-version-id": version })
        : s3Response(403),
    );
    const client = localS3Client(handle);
    try {
      const store = new AwsCandidateExportArtifactStore(
        "synthetic-export-bucket",
        "synthetic-kms-key",
        client,
      );
      await expect(store.deleteExactVersion(exportKey, version)).resolves.toBe(true);
      expect(handle).toHaveBeenCalledOnce();
      expect(handle.mock.calls[0]?.[0]).toMatchObject({
        method: "DELETE",
        path: `/synthetic-export-bucket/${exportKey}`,
        query: { versionId: version },
      });
      expect(handle.mock.calls[0]?.[0].body).toBeUndefined();
      // The old follow-up fails under the same local transport; it is not part of deletion.
      await expect(
        client.send(
          new HeadObjectCommand({
            Bucket: "synthetic-export-bucket",
            Key: exportKey,
            VersionId: version,
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
      expect(handle).toHaveBeenCalledTimes(2);
      expect(handle.mock.calls[1]?.[0].method).toBe("HEAD");
    } finally {
      client.destroy();
    }
  });

  it("replays only the same immutable DELETE when S3 acknowledges that exact version again", async () => {
    const version = "exact-expired-version";
    const handle = vi.fn(async (_request: LocalS3Request) =>
      s3Response(204, { "x-amz-version-id": version, "x-amz-delete-marker": "false" }),
    );
    const client = localS3Client(handle);
    try {
      const store = new AwsCandidateExportArtifactStore(
        "synthetic-export-bucket",
        "synthetic-kms-key",
        client,
      );
      await expect(store.deleteExactVersion(exportKey, version)).resolves.toBe(true);
      await expect(store.deleteExactVersion(exportKey, version)).resolves.toBe(true);
      expect(handle).toHaveBeenCalledTimes(2);
      for (const [request] of handle.mock.calls) {
        expect(request).toMatchObject({
          method: "DELETE",
          path: `/synthetic-export-bucket/${exportKey}`,
          query: { versionId: version },
        });
        expect(request.body).toBeUndefined();
      }
      expect(handle.mock.calls[0]?.[0].query).toEqual(handle.mock.calls[1]?.[0].query);
    } finally {
      client.destroy();
    }
  });

  it.each([
    { label: "missing version header", status: 204, headers: {} },
    {
      label: "wrong version header",
      status: 204,
      headers: { "x-amz-version-id": "other-version" },
    },
    {
      label: "delete marker",
      status: 204,
      headers: { "x-amz-version-id": "exact-expired-version", "x-amz-delete-marker": "true" },
    },
    {
      label: "wrong success status",
      status: 202,
      headers: { "x-amz-version-id": "exact-expired-version" },
    },
  ])("rejects real SDK response with $label", async ({ status, headers }) => {
    const handle = vi.fn(async (_request: LocalS3Request) =>
      s3Response(status, headers as Record<string, string>),
    );
    const client = localS3Client(handle);
    try {
      const store = new AwsCandidateExportArtifactStore(
        "synthetic-export-bucket",
        "synthetic-kms-key",
        client,
      );
      await expect(store.deleteExactVersion(exportKey, "exact-expired-version")).rejects.toThrow(
        "CandidateExportArtifactDeletionUnconfirmed",
      );
      expect(handle).toHaveBeenCalledOnce();
    } finally {
      client.destroy();
    }
  });

  it.each([403, 404])(
    "propagates real SDK DELETE %s errors without an absence fallback",
    async (status) => {
      const handle = vi.fn(async (_request: LocalS3Request) => s3Response(status));
      const client = localS3Client(handle);
      try {
        const store = new AwsCandidateExportArtifactStore(
          "synthetic-export-bucket",
          "synthetic-kms-key",
          client,
        );
        await expect(
          store.deleteExactVersion(exportKey, "exact-expired-version"),
        ).rejects.toMatchObject({ $metadata: { httpStatusCode: status } });
        expect(handle).toHaveBeenCalledOnce();
        expect(handle.mock.calls[0]?.[0].method).toBe("DELETE");
      } finally {
        client.destroy();
      }
    },
  );

  it("propagates a real SDK transport timeout without a second command", async () => {
    const timeout = Object.assign(new Error("synthetic timeout"), {
      name: "TimeoutError",
      code: "ETIMEDOUT",
    });
    const handle = vi.fn(async (_request: LocalS3Request) => {
      throw timeout;
    });
    const client = localS3Client(handle);
    try {
      const store = new AwsCandidateExportArtifactStore(
        "synthetic-export-bucket",
        "synthetic-kms-key",
        client,
      );
      await expect(
        store.deleteExactVersion(exportKey, "exact-expired-version"),
      ).rejects.toMatchObject({ name: "TimeoutError", code: "ETIMEDOUT" });
      expect(handle).toHaveBeenCalledOnce();
    } finally {
      client.destroy();
    }
  });

  it("deletes exact versions and delete markers without touching prefix neighbors", async () => {
    const inventories = new Map<string, number>();
    const send = vi.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: Record<string, unknown> }).input;
      if (name === "ListObjectVersionsCommand") {
        const key = String(input.Prefix);
        if (key.endsWith("/")) return { Versions: [], DeleteMarkers: [], IsTruncated: false };
        const pass = inventories.get(key) ?? 0;
        inventories.set(key, pass + 1);
        return pass === 0
          ? {
              Versions: [
                { Key: key, VersionId: `${key}-v1` },
                { Key: `${key}-neighbor`, VersionId: "must-not-delete" },
              ],
              DeleteMarkers: [{ Key: key, VersionId: `${key}-marker` }],
              IsTruncated: false,
            }
          : { Versions: [], DeleteMarkers: [], IsTruncated: false };
      }
      if (name === "DeleteObjectsCommand") return {};
      throw new Error("Unexpected command");
    });
    const store = new AwsCandidateDocumentObjectStore("synthetic-document-bucket", { send });

    await expect(
      store.deleteAllVersionsAndMarkers([
        {
          documentId: "019c2b89-79b2-7000-8000-000000000001",
          sourceObjectKey: "quarantine/user/document/source",
          sourceObjectVersion: "source-v1",
          normalizedObjectKey: "normalized/user/document/body",
          normalizedObjectVersion: "normalized-v1",
        },
      ]),
    ).resolves.toEqual({ exactInventoryEmpty: true });

    const deleted = send.mock.calls.flatMap(([command]) => {
      if (
        !command ||
        typeof command !== "object" ||
        (command as { constructor?: { name?: unknown } }).constructor?.name !==
          "DeleteObjectsCommand"
      ) {
        return [];
      }
      const input = commandInput(command);
      const deletion = input.Delete;
      if (!deletion || typeof deletion !== "object") return [];
      const objects = (deletion as { Objects?: unknown }).Objects;
      return Array.isArray(objects) ? (objects as Array<{ Key: string; VersionId: string }>) : [];
    });
    expect(deleted).toHaveLength(4);
    expect(deleted.some((item) => item.VersionId === "must-not-delete")).toBe(false);
  });
});

describe("AwsCandidateDocumentObjectStore resume purge (ADR-034)", () => {
  const documentId = "019c2b89-79b2-7000-8000-000000000001";
  const otherId = "019c2b89-79b2-7000-8000-000000000002";
  type Entry = { Key: string; VersionId: string };

  function fakeBucket(
    initial: Entry[],
    options: {
      reappear?: Entry[];
      reappearWhenKey?: string;
      deleteErrors?: boolean;
      pageSize?: number;
    } = {},
  ) {
    let versions = [...initial];
    const deleted: Entry[] = [];
    const listings: string[] = [];
    const send = vi.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: Record<string, unknown> }).input;
      if (name === "ListObjectVersionsCommand") {
        const prefix = String(input.Prefix);
        listings.push(prefix);
        const matching = versions.filter((entry) => entry.Key.startsWith(prefix));
        const pageSize = options.pageSize ?? 1000;
        const start = input.KeyMarker ? Number(String(input.VersionIdMarker ?? "0")) : 0;
        const page = matching.slice(start, start + pageSize);
        const more = start + pageSize < matching.length;
        return {
          Versions: page.filter((entry) => !entry.VersionId.startsWith("marker")),
          DeleteMarkers: page.filter((entry) => entry.VersionId.startsWith("marker")),
          IsTruncated: more,
          ...(more ? { NextKeyMarker: "next", NextVersionIdMarker: String(start + pageSize) } : {}),
        };
      }
      if (name === "DeleteObjectsCommand") {
        const objects = (input.Delete as { Objects: Entry[] }).Objects;
        if (options.deleteErrors)
          return { Errors: [{ Key: objects[0]?.Key, Code: "AccessDenied" }] };
        deleted.push(...objects);
        versions = versions.filter(
          (entry) =>
            !objects.some(
              (object) => object.Key === entry.Key && object.VersionId === entry.VersionId,
            ),
        );
        if (
          options.reappear &&
          (!options.reappearWhenKey ||
            objects.some((entry) => entry.Key === options.reappearWhenKey))
        )
          versions.push(...options.reappear);
        return {};
      }
      throw new Error("Unexpected command");
    });
    return {
      store: new AwsCandidateDocumentObjectStore("synthetic-document-bucket", { send }),
      send,
      deleted,
      listings,
      current: () => versions,
    };
  }

  const mine = [
    { Key: `quarantine/${documentId}/source`, VersionId: "v1" },
    { Key: `quarantine/${documentId}/source`, VersionId: "marker-1" },
    {
      Key: `normalized/${documentId}/${"a".repeat(64)}/resume-parser-v6/resume.json`,
      VersionId: "v2",
    },
    {
      Key: `normalized/${documentId}/${"a".repeat(64)}/resume-parser-v7/resume.json`,
      VersionId: "v3",
    },
  ];
  const neighbors = [
    { Key: `quarantine/${otherId}/source`, VersionId: "keep-1" },
    {
      Key: `normalized/${otherId}/${"b".repeat(64)}/resume-parser-v7/resume.json`,
      VersionId: "keep-2",
    },
    { Key: `quarantine/${documentId}x/source`, VersionId: "keep-3" },
    { Key: `exports/${documentId}/file`, VersionId: "keep-4" },
  ];

  it("removes every version and marker under both prefixes, including an older parser version, and nothing else", async () => {
    const bucket = fakeBucket([...mine, ...neighbors]);
    await expect(bucket.store.purgeDocumentPrefixes(documentId)).resolves.toEqual({
      deleted: 4,
      remaining: 0,
    });
    expect(bucket.deleted.map((entry) => entry.VersionId).sort()).toEqual([
      "marker-1",
      "v1",
      "v2",
      "v3",
    ]);
    expect(
      bucket
        .current()
        .map((entry) => entry.VersionId)
        .sort(),
    ).toEqual(["keep-1", "keep-2", "keep-3", "keep-4"]);
    // it listed each prefix before deleting and again after, and only its own two prefixes
    expect(new Set(bucket.listings)).toEqual(
      new Set([`quarantine/${documentId}/`, `normalized/${documentId}/`]),
    );
    expect(bucket.listings).toHaveLength(4);
  });

  it("follows pagination so a large history is fully removed", async () => {
    const many = Array.from({ length: 7 }, (_unused, index) => ({
      Key: `quarantine/${documentId}/source`,
      VersionId: `v${index}`,
    }));
    const bucket = fakeBucket(many, { pageSize: 3 });
    await expect(bucket.store.purgeDocumentPrefixes(documentId)).resolves.toEqual({
      deleted: 7,
      remaining: 0,
    });
  });

  const accountInventory = [
    {
      documentId,
      sourceObjectKey: `quarantine/${documentId}/source`,
      sourceObjectVersion: "v1",
      normalizedObjectKey: `normalized/${documentId}/${"a".repeat(64)}/resume-parser-v7/resume.json`,
      normalizedObjectVersion: "v3",
    },
  ];

  it("account deletion removes unrecorded older-parser versions and markers, preserves other documents, and replays safely", async () => {
    const bucket = fakeBucket([...mine, ...neighbors], { pageSize: 2 });
    await expect(bucket.store.deleteAllVersionsAndMarkers(accountInventory)).resolves.toEqual({
      exactInventoryEmpty: true,
    });
    expect(bucket.deleted.map((entry) => entry.VersionId).sort()).toEqual([
      "marker-1",
      "v1",
      "v2",
      "v3",
    ]);
    expect(bucket.current()).toEqual(neighbors);
    await expect(bucket.store.deleteAllVersionsAndMarkers(accountInventory)).resolves.toEqual({
      exactInventoryEmpty: true,
    });
    expect(bucket.deleted).toHaveLength(4);
  });

  it("account deletion refuses absence attestation when an unrecorded normalized key reappears", async () => {
    const late = { Key: `normalized/${documentId}/old-parser/resume.json`, VersionId: "late-1" };
    const bucket = fakeBucket(mine, { reappear: [late] });
    await expect(bucket.store.deleteAllVersionsAndMarkers(accountInventory)).resolves.toEqual({
      exactInventoryEmpty: false,
    });
  });

  it("rechecks earlier document prefixes after a later document purge", async () => {
    const later = { Key: `normalized/${otherId}/older-parser/resume.json`, VersionId: "later" };
    const late = { Key: `normalized/${documentId}/older-parser/resume.json`, VersionId: "late" };
    const bucket = fakeBucket([...mine, later], { reappear: [late], reappearWhenKey: later.Key });
    await expect(
      bucket.store.deleteAllVersionsAndMarkers([
        ...accountInventory,
        {
          documentId: otherId,
          sourceObjectKey: `quarantine/${otherId}/source`,
          sourceObjectVersion: "absent-version",
        },
      ]),
    ).resolves.toEqual({ exactInventoryEmpty: false });
    expect(bucket.current()).toEqual([late]);
  });

  it("account deletion validates every document identity before any object mutation", async () => {
    const bucket = fakeBucket(mine);
    await expect(
      bucket.store.deleteAllVersionsAndMarkers([
        ...accountInventory,
        {
          documentId: `${documentId}/../${otherId}`,
          sourceObjectKey: `quarantine/${documentId}/source`,
          sourceObjectVersion: "v1",
        },
      ]),
    ).rejects.toThrow("CandidateDocumentInventoryIdentityRejected");
    expect(bucket.send).not.toHaveBeenCalled();
  });

  it.each([
    { Versions: [], DeleteMarkers: [] },
    { IsTruncated: "false", Versions: [] },
    { IsTruncated: false, Versions: {} },
    { IsTruncated: false, DeleteMarkers: null },
    { IsTruncated: false, Versions: [{ Key: `quarantine/${otherId}/source`, VersionId: "other" }] },
    { IsTruncated: false, Versions: [{ Key: `quarantine/${documentId}/source`, VersionId: "" }] },
    { IsTruncated: false, DeleteMarkers: [{ Key: `quarantine/${documentId}/source` }] },
  ])("refuses malformed or out-of-prefix inventory before deletion: %j", async (page) => {
    const send = vi.fn(async () => page);
    const store = new AwsCandidateDocumentObjectStore("synthetic-document-bucket", { send });
    await expect(store.deleteAllVersionsAndMarkers(accountInventory)).rejects.toThrow(
      "CandidateDocumentInventoryInvalid",
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("refuses repeated pagination before issuing any delete command", async () => {
    const send = vi.fn(async () => ({
      IsTruncated: true,
      Versions: [],
      NextKeyMarker: `quarantine/${documentId}/source`,
      NextVersionIdMarker: "same",
    }));
    const store = new AwsCandidateDocumentObjectStore("synthetic-document-bucket", { send });
    await expect(store.deleteAllVersionsAndMarkers(accountInventory)).rejects.toThrow(
      "CandidateDocumentInventoryPaginationRejected",
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reports what a second listing still finds, so the caller cannot mistake it for empty", async () => {
    const late = { Key: `normalized/${documentId}/late/resume.json`, VersionId: "late-1" };
    const bucket = fakeBucket(mine, { reappear: [late] });
    const result = await bucket.store.purgeDocumentPrefixes(documentId);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("fails on a per-object deletion error instead of reporting success", async () => {
    const bucket = fakeBucket(mine, { deleteErrors: true });
    await expect(bucket.store.purgeDocumentPrefixes(documentId)).rejects.toThrow(
      "ResumePurgeObjectDeletionIncomplete",
    );
  });

  it.each([
    ["a traversal attempt", `${documentId}/../${otherId}`],
    ["a prefix of an id", documentId.slice(0, 20)],
    ["an empty id", ""],
    ["a path", "quarantine/x/y"],
    ["an upper-case id", documentId.toUpperCase()],
  ])("rejects %s before any S3 call", async (_name, value) => {
    const bucket = fakeBucket(mine);
    await expect(bucket.store.purgeDocumentPrefixes(value)).rejects.toThrow(
      "ResumePurgeDocumentIdentityRejected",
    );
    expect(bucket.send).not.toHaveBeenCalled();
  });
});
