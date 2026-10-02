import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { CoverLetterIntegrityError } from "./cover-letter.js";
import { S3CoverLetterObjectStore } from "./cover-letter-objects.js";

const documentId = randomUUID();
const bytes = new TextEncoder().encode('{"synthetic":"draft"}');
const sha256 = createHash("sha256").update(bytes).digest("hex");
const input = {
  documentId,
  objectKey: `normalized/${documentId}/cover-letter.v1.json`,
  bytes,
  sha256,
};
const readInput = {
  documentId,
  objectKey: input.objectKey,
  objectVersion: "synthetic-v1",
  sha256,
  sizeBytes: bytes.length,
};
const metadata = () => ({
  VersionId: "synthetic-v1",
  ContentLength: bytes.length,
  ContentType: "application/json",
  ServerSideEncryption: "aws:kms",
  SSEKMSKeyId: "synthetic-kms",
  Metadata: { "document-id": documentId, "cover-letter-sha256": sha256 },
});
const service = (
  send: (
    command: unknown,
    options?: { abortSignal: AbortSignal },
  ) => Promise<Record<string, unknown>>,
) => new S3CoverLetterObjectStore("synthetic-bucket", "synthetic-kms", { send });

describe("encrypted immutable cover-letter objects", () => {
  it("pins the key, KMS key, conditional write, checksum and exact returned version", async () => {
    const send = vi.fn(async (command: unknown, options?: { abortSignal: AbortSignal }) => {
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      if (command instanceof PutObjectCommand) {
        expect(command.input).toMatchObject({
          Bucket: "synthetic-bucket",
          Key: input.objectKey,
          IfNoneMatch: "*",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: "synthetic-kms",
          ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        });
        return { VersionId: "synthetic-v1" };
      }
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect((command as HeadObjectCommand).input.VersionId).toBe("synthetic-v1");
      return metadata();
    });
    expect(await service(send).putIfAbsent(input)).toEqual({ objectVersion: "synthetic-v1" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("recovers a conditional conflict only through matching immutable metadata", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) throw { name: "PreconditionFailed" };
      return metadata();
    });
    expect(await service(send).putIfAbsent(input)).toEqual({ objectVersion: "synthetic-v1" });
    await expect(
      service(async (command) => {
        if (command instanceof PutObjectCommand) throw { $metadata: { httpStatusCode: 412 } };
        return {
          ...metadata(),
          Metadata: { "document-id": documentId, "cover-letter-sha256": "0".repeat(64) },
        };
      }).putIfAbsent(input),
    ).rejects.toThrow(CoverLetterIntegrityError);
  });

  it.each([
    { objectKey: "normalized/foreign/cover-letter.v1.json" },
    { documentId: "../escape" },
    { sha256: "not-a-hash" },
    { sha256: "a".repeat(64) },
    { bytes: new Uint8Array() },
    { bytes: new Uint8Array(32_769) },
  ])("refuses malformed identities and bounded payloads before I/O", async (changes) => {
    const send = vi.fn();
    await expect(service(send).putIfAbsent({ ...input, ...changes })).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("withholds raw SDK errors and refuses unversioned writes", async () => {
    for (const send of [
      async () => {
        throw new Error("synthetic credential and candidate text");
      },
      async () => ({}),
    ]) {
      await expect(service(send).putIfAbsent(input)).rejects.toThrow(
        "Cover-letter content failed integrity verification",
      );
    }
  });

  it("reads only the exact version and checks the streamed bytes", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        expect(command.input.VersionId).toBe("synthetic-v1");
        return metadata();
      }
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input.VersionId).toBe("synthetic-v1");
      return {
        Body: (async function* () {
          yield bytes.slice(0, 5);
          yield bytes.slice(5);
        })(),
      };
    });
    expect(await service(send).read(readInput)).toEqual(Buffer.from(bytes));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    { VersionId: "other-v" },
    { ContentLength: bytes.length + 1 },
    { ContentType: "text/plain" },
    { ServerSideEncryption: "AES256" },
    { SSEKMSKeyId: "foreign-key" },
    { Metadata: {} },
  ])("rejects mismatched exact-version metadata before downloading", async (changes) => {
    const send = vi.fn(async () => ({ ...metadata(), ...changes }));
    await expect(service(send).read(readInput)).rejects.toThrow(CoverLetterIntegrityError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Uint8Array(bytes.length),
    bytes.slice(1),
    new Uint8Array(32_769),
    undefined,
    (async function* () {
      yield "not byte data";
    })(),
    (async function* () {
      yield new Uint8Array(32_769);
    })(),
  ])("rejects corrupt, incomplete, missing and oversized bodies", async (Body) => {
    const send = async (command: unknown) =>
      command instanceof HeadObjectCommand ? metadata() : { Body };
    await expect(service(send).read(readInput)).rejects.toThrow(CoverLetterIntegrityError);
  });
});
