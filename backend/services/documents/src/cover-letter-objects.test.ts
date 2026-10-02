import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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
) =>
  new S3CoverLetterObjectStore("synthetic-bucket", "synthetic-kms", {
    send,
    config: { maxAttempts: async () => 1 },
  });

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
        return { VersionId: "synthetic-v1", $metadata: { attempts: 1, httpStatusCode: 200 } };
      }
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect((command as HeadObjectCommand).input.VersionId).toBe("synthetic-v1");
      return metadata();
    });
    expect(await service(send).putIfAbsent(input)).toEqual({
      objectVersion: "synthetic-v1",
      created: true,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("recovers a conditional conflict only through matching immutable metadata", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) throw { name: "PreconditionFailed" };
      return metadata();
    });
    expect(await service(send).putIfAbsent(input)).toEqual({
      objectVersion: "synthetic-v1",
      created: false,
    });
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
        VersionId: "synthetic-v1",
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
      yield new Uint8Array();
    })(),
    (async function* () {
      yield new Uint8Array(32_769);
    })(),
  ])("rejects corrupt, incomplete, missing and oversized bodies", async (Body) => {
    const send = async (command: unknown) =>
      command instanceof HeadObjectCommand ? metadata() : { VersionId: "synthetic-v1", Body };
    await expect(service(send).read(readInput)).rejects.toThrow(CoverLetterIntegrityError);
  });

  it.each([undefined, 2, 0, "1"])(
    "refuses SDK retry policy %s before any I/O",
    async (attempts) => {
      const send = vi.fn();
      const store = new S3CoverLetterObjectStore("synthetic-bucket", "synthetic-kms", {
        send,
        ...(attempts === undefined
          ? {}
          : { config: { maxAttempts: async () => attempts as number } }),
      });
      await expect(store.putIfAbsent(input)).rejects.toThrow(CoverLetterIntegrityError);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    { attempts: 2, httpStatusCode: 200 },
    { attempts: 1, httpStatusCode: 500 },
    { attempts: "1", httpStatusCode: 200 },
  ])("does not recover missing or ambiguous write receipts through HEAD", async ($metadata) => {
    const send = vi.fn(async () => ({ VersionId: "synthetic-v1", $metadata }));
    await expect(service(send).putIfAbsent(input)).rejects.toThrow(CoverLetterIntegrityError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(["null", "", "unsafe\nversion", "x".repeat(1025)])(
    "refuses unsafe version %s before I/O",
    async (objectVersion) => {
      const send = vi.fn();
      await expect(service(send).read({ ...readInput, objectVersion })).rejects.toThrow(
        CoverLetterIntegrityError,
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "foreign-v1", "null"])(
    "rejects mismatched GET version %s",
    async (VersionId) => {
      const destroy = vi.fn();
      const send = vi.fn(async (command: unknown) =>
        command instanceof HeadObjectCommand ? metadata() : { VersionId, Body: { destroy } },
      );
      await expect(service(send).read(readInput)).rejects.toThrow(CoverLetterIntegrityError);
      expect(destroy).toHaveBeenCalledOnce();
    },
  );

  it("snapshots write identity and bytes before asynchronous policy resolution", async () => {
    const request = { ...input, bytes: Uint8Array.from(bytes) };
    const store = new S3CoverLetterObjectStore("synthetic-bucket", "synthetic-kms", {
      config: {
        maxAttempts: async () => {
          request.documentId = randomUUID();
          request.objectKey = "foreign";
          request.sha256 = "0".repeat(64);
          request.bytes.fill(0);
          return 1;
        },
      },
      send: async (command) => {
        if (command instanceof PutObjectCommand) {
          expect(command.input.Key).toBe(input.objectKey);
          expect(command.input.Body).toEqual(bytes);
          expect(command.input.Metadata?.["document-id"]).toBe(documentId);
          return { VersionId: "synthetic-v1", $metadata: { attempts: 1, httpStatusCode: 200 } };
        }
        expect((command as HeadObjectCommand).input.Key).toBe(input.objectKey);
        return metadata();
      },
    });
    expect(await store.putIfAbsent(request)).toEqual({
      objectVersion: "synthetic-v1",
      created: true,
    });
  });

  it("snapshots read bindings before HEAD and detaches returned bytes", async () => {
    const request = { ...readInput };
    const body = Uint8Array.from(bytes);
    const store = service(async (command) => {
      if (command instanceof HeadObjectCommand) {
        request.objectKey = "foreign";
        request.objectVersion = "foreign";
        request.sha256 = "0".repeat(64);
        return metadata();
      }
      expect((command as GetObjectCommand).input).toMatchObject({
        Key: input.objectKey,
        VersionId: "synthetic-v1",
      });
      return { VersionId: "synthetic-v1", Body: body };
    });
    const result = await store.read(request);
    body.fill(0);
    expect(result).toEqual(Buffer.from(bytes));
  });

  it.each(["policy", "put", "head", "get", "stream"])(
    "bounds stalled %s even when the port ignores abort",
    async (stage) => {
      const controller = new AbortController();
      const never = () => new Promise<never>(() => undefined);
      const destroy = vi.fn();
      const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
      const store = new S3CoverLetterObjectStore("synthetic-bucket", "synthetic-kms", {
        config: {
          maxAttempts: async () => {
            if (stage === "policy") {
              controller.abort();
              return never();
            }
            return 1;
          },
        },
        send: async (command) => {
          if (
            (stage === "put" && command instanceof PutObjectCommand) ||
            (stage === "head" && command instanceof HeadObjectCommand) ||
            (stage === "get" && command instanceof GetObjectCommand)
          ) {
            controller.abort();
            return never();
          }
          if (command instanceof HeadObjectCommand) return metadata();
          return {
            VersionId: "synthetic-v1",
            Body: {
              destroy,
              [Symbol.asyncIterator]: () => ({
                next: () => {
                  controller.abort();
                  return never();
                },
                return: returned,
              }),
            },
          };
        },
      });
      await expect(
        stage === "policy" || stage === "put"
          ? store.putIfAbsent(input, controller.signal)
          : store.read(readInput, controller.signal),
      ).rejects.toThrow(CoverLetterIntegrityError);
      if (stage === "stream") {
        expect(destroy).toHaveBeenCalledOnce();
        expect(returned).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([200, 500])(
    "uses exactly one HTTP PUT with the installed SDK on status %s (offline)",
    async (statusCode) => {
      const methods: string[] = [];
      const client = new S3Client({
        region: "us-east-2",
        maxAttempts: 1,
        credentials: { accessKeyId: "SYNTHETIC", secretAccessKey: "synthetic-only" },
        requestHandler: {
          handle: async (request: { method: string }) => {
            methods.push(request.method);
            if (statusCode === 500)
              return {
                response: {
                  statusCode,
                  headers: { "content-type": "application/xml" },
                  body: Buffer.from(
                    "<Error><Code>ServiceUnavailable</Code><Message>Synthetic</Message></Error>",
                  ),
                },
              };
            return {
              response: {
                statusCode: 200,
                headers: {
                  "x-amz-version-id": "synthetic-v1",
                  ...(request.method === "HEAD"
                    ? {
                        "content-length": String(bytes.length),
                        "content-type": "application/json",
                        "x-amz-server-side-encryption": "aws:kms",
                        "x-amz-server-side-encryption-aws-kms-key-id": "synthetic-kms",
                        "x-amz-meta-document-id": documentId,
                        "x-amz-meta-cover-letter-sha256": sha256,
                      }
                    : {}),
                },
                body: Buffer.alloc(0),
              },
            };
          },
        },
      });
      const store = new S3CoverLetterObjectStore("synthetic-bucket", "synthetic-kms", {
        config: client.config,
        send: async (command, options) => ({
          ...(await client.send(
            command as PutObjectCommand | HeadObjectCommand | GetObjectCommand,
            options,
          )),
        }),
      });
      try {
        if (statusCode === 200)
          expect(await store.putIfAbsent(input)).toEqual({
            objectVersion: "synthetic-v1",
            created: true,
          });
        else await expect(store.putIfAbsent(input)).rejects.toThrow(CoverLetterIntegrityError);
        expect(methods.filter((method) => method === "PUT")).toHaveLength(1);
        expect(methods).toEqual(statusCode === 200 ? ["PUT", "HEAD"] : ["PUT"]);
      } finally {
        client.destroy();
      }
    },
  );

  it("rechecks retry policy before each write", async () => {
    const send = vi.fn(async (command: unknown) =>
      command instanceof PutObjectCommand
        ? { VersionId: "synthetic-v1", $metadata: { attempts: 1, httpStatusCode: 200 } }
        : metadata(),
    );
    const store = new S3CoverLetterObjectStore("synthetic-bucket", "synthetic-kms", {
      send,
      config: { maxAttempts: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2) },
    });
    await store.putIfAbsent(input);
    await expect(store.putIfAbsent(input)).rejects.toThrow(CoverLetterIntegrityError);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not treat a late successful PUT as an acknowledgement or start HEAD", async () => {
    const controller = new AbortController();
    let resolve: (value: Record<string, unknown>) => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((done) => {
          resolve = done;
          controller.abort();
        }),
    );
    await expect(service(send).putIfAbsent(input, controller.signal)).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    resolve({ VersionId: "synthetic-v1", $metadata: { attempts: 1, httpStatusCode: 200 } });
    await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
  });

  it("destroys a GET body returned after local cancellation without reading it", async () => {
    const controller = new AbortController();
    let resolve: (value: Record<string, unknown>) => void = () => undefined;
    const destroy = vi.fn();
    const iterator = vi.fn();
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) return metadata();
      return new Promise<Record<string, unknown>>((done) => {
        resolve = done;
        controller.abort();
      });
    });
    await expect(service(send).read(readInput, controller.signal)).rejects.toThrow(
      CoverLetterIntegrityError,
    );
    resolve({ VersionId: "synthetic-v1", Body: { destroy, [Symbol.asyncIterator]: iterator } });
    await Promise.resolve();
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledOnce();
    expect(iterator).not.toHaveBeenCalled();
  });
});
