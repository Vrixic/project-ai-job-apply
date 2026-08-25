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

  it("deletes and proves absence of only the expired export version", async () => {
    const notFound = Object.assign(new Error("absent"), {
      name: "NoSuchVersion",
      $metadata: { httpStatusCode: 404 },
    });
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(notFound);
    const store = new AwsCandidateExportArtifactStore(
      "synthetic-export-bucket",
      "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000001",
      { send },
    );
    await expect(
      store.deleteExactVersion("candidate-data-exports/user/export.json", "exact-expired-version"),
    ).resolves.toBe(true);
    expect(
      send.mock.calls.map(([command]) => ({
        name: (command as { constructor: { name: string } }).constructor.name,
        input: (command as { input: unknown }).input,
      })),
    ).toEqual([
      {
        name: "DeleteObjectCommand",
        input: {
          Bucket: "synthetic-export-bucket",
          Key: "candidate-data-exports/user/export.json",
          VersionId: "exact-expired-version",
        },
      },
      {
        name: "HeadObjectCommand",
        input: {
          Bucket: "synthetic-export-bucket",
          Key: "candidate-data-exports/user/export.json",
          VersionId: "exact-expired-version",
        },
      },
    ]);
  });

  it("deletes exact versions and delete markers without touching prefix neighbors", async () => {
    const inventories = new Map<string, number>();
    const send = vi.fn(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: Record<string, unknown> }).input;
      if (name === "ListObjectVersionsCommand") {
        const key = String(input.Prefix);
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
