import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  COVER_LETTER_PROVIDER_MODEL,
  CoverLetterProviderTransportError,
  coverLetterProviderKey,
  coverLetterProviderSha256,
  encodeCoverLetterProviderObject,
} from "./cover-letter-provider-contract.js";
import { S3CoverLetterProviderObjects } from "./cover-letter-provider-objects.js";

const documentId = "019d04cf-1f80-7000-8000-000000000001";
const kms = "arn:aws:kms:us-east-2:123456789012:key/019d04cf-1f80-7000-8000-000000000002";
const body = {
  schemaVersion: 1,
  documentId,
  requestSha256: "a".repeat(64),
  state: "claimed",
  dispatchedAt: "2026-10-02T12:00:00.000Z",
};
const bytes = encodeCoverLetterProviderObject("dispatch", body);
const sha256 = coverLetterProviderSha256(bytes);
const reference = {
  objectVersion: "synthetic-v1",
  etag: '"synthetic-etag"',
  sha256,
  sizeBytes: bytes.length,
};
const head = () => ({
  VersionId: reference.objectVersion,
  ETag: reference.etag,
  ContentLength: bytes.length,
  ContentType: "application/json",
  ServerSideEncryption: "aws:kms",
  SSEKMSKeyId: kms,
  Metadata: {
    "document-id": documentId,
    "generation-slot": "dispatch",
    "generation-sha256": sha256,
  },
});
const service = (
  send: (
    command: unknown,
    options: { abortSignal: AbortSignal },
  ) => Promise<Record<string, unknown>>,
) => new S3CoverLetterProviderObjects("synthetic-bucket", kms, { send });

describe("isolated provider owned encrypted objects (offline S3)", () => {
  it("conditionally writes only the derived owner slot with KMS and checksum", async () => {
    const send = vi.fn(async (command: unknown, options: { abortSignal: AbortSignal }) => {
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      if (command instanceof PutObjectCommand) {
        expect(command.input).toMatchObject({
          Bucket: "synthetic-bucket",
          Key: coverLetterProviderKey(documentId, "dispatch"),
          IfNoneMatch: "*",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: kms,
          ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        });
        return { VersionId: reference.objectVersion };
      }
      expect(command).toBeInstanceOf(HeadObjectCommand);
      expect((command as HeadObjectCommand).input.VersionId).toBe(reference.objectVersion);
      return head();
    });
    expect(await service(send).putIfAbsent(documentId, "dispatch", bytes)).toEqual({
      created: true,
      reference,
    });
  });
  it("returns the existing reference on conflict without granting a new dispatch", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) throw { name: "PreconditionFailed" };
      return head();
    });
    const different = encodeCoverLetterProviderObject("dispatch", {
      ...body,
      dispatchedAt: "2026-10-02T12:00:01.000Z",
    });
    expect(await service(send).putIfAbsent(documentId, "dispatch", different)).toEqual({
      created: false,
      reference,
    });
    expect(reference.sha256).not.toBe(coverLetterProviderSha256(different));
  });
  it("treats only genuine HEAD absence as missing, never authorization/transport failure", async () => {
    expect(
      await service(async () => {
        throw { name: "NotFound" };
      }).find(documentId, "dispatch"),
    ).toBeUndefined();
    for (const error of [{ name: "AccessDenied" }, new Error("synthetic-private-sdk")])
      await expect(
        service(async () => {
          throw error;
        }).find(documentId, "dispatch"),
      ).rejects.toThrow(CoverLetterProviderTransportError);
  });
  it.each([
    { VersionId: "null" },
    { ContentLength: 4_097 },
    { ContentType: "text/plain" },
    { ServerSideEncryption: "AES256" },
    { SSEKMSKeyId: "foreign" },
    { Metadata: { ...head().Metadata, "document-id": "foreign" } },
    { Metadata: { ...head().Metadata, "generation-slot": "request" } },
  ])("rejects foreign, oversized or unversioned metadata", async (changed) => {
    await expect(
      service(async () => ({ ...head(), ...changed })).find(documentId, "dispatch"),
    ).rejects.toThrow(CoverLetterProviderTransportError);
  });
  it("rejects cross-owner content, invalid bytes and already-aborted requests before SDK I/O", async () => {
    const send = vi.fn();
    const store = service(send);
    for (const invalid of [
      new Uint8Array(),
      new Uint8Array(4_097),
      encodeCoverLetterProviderObject("dispatch", {
        ...body,
        documentId: "019d04cf-1f80-7000-8000-000000000003",
      }),
    ])
      await expect(store.putIfAbsent(documentId, "dispatch", invalid)).rejects.toThrow(
        CoverLetterProviderTransportError,
      );
    await expect(store.find("../foreign", "dispatch")).rejects.toThrow(
      CoverLetterProviderTransportError,
    );
    await expect(store.find(documentId, "dispatch", AbortSignal.abort())).rejects.toThrow(
      CoverLetterProviderTransportError,
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("reads the exact version and verifies owned canonical bytes", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) return head();
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({
        Bucket: "synthetic-bucket",
        Key: coverLetterProviderKey(documentId, "dispatch"),
        VersionId: reference.objectVersion,
      });
      return { VersionId: reference.objectVersion, Body: bytes };
    });
    expect(await service(send).read(documentId, "dispatch", reference)).toEqual(bytes);
  });
  it("rejects wrong-version, corrupted and oversized reads", async () => {
    for (const response of [
      { VersionId: "foreign", Body: bytes },
      { VersionId: reference.objectVersion, Body: new Uint8Array(bytes.length) },
      { VersionId: reference.objectVersion, Body: new Uint8Array(bytes.length + 1) },
    ])
      await expect(
        service(async (command) => (command instanceof HeadObjectCommand ? head() : response)).read(
          documentId,
          "dispatch",
          reference,
        ),
      ).rejects.toThrow(CoverLetterProviderTransportError);
  });

  it("closes the SDK body even when version validation fails before iteration", async () => {
    const destroy = vi.fn();
    const stream = {
      destroy,
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    };
    await expect(
      service(async (command) =>
        command instanceof HeadObjectCommand ? head() : { VersionId: "foreign", Body: stream },
      ).read(documentId, "dispatch", reference),
    ).rejects.toThrow(CoverLetterProviderTransportError);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("refuses cross-owner plaintext even when malicious metadata supplies its matching checksum", async () => {
    const foreign = encodeCoverLetterProviderObject("dispatch", {
      ...body,
      documentId: "019d04cf-1f80-7000-8000-000000000003",
    });
    const hash = coverLetterProviderSha256(foreign);
    const malicious = {
      ...head(),
      ContentLength: foreign.length,
      Metadata: { ...head().Metadata, "generation-sha256": hash },
    };
    await expect(
      service(async (command) =>
        command instanceof HeadObjectCommand
          ? malicious
          : { VersionId: reference.objectVersion, Body: foreign },
      ).read(documentId, "dispatch", { ...reference, sha256: hash, sizeBytes: foreign.length }),
    ).rejects.toThrow(CoverLetterProviderTransportError);
  });
  it("bounds streaming bytes and closes the iterator without accepting string chunks", async () => {
    const close = vi.fn();
    const stream = {
      async *[Symbol.asyncIterator]() {
        try {
          yield bytes.subarray(0, 10);
          yield bytes.subarray(10);
        } finally {
          close();
        }
      },
    };
    expect(
      await service(async (command) =>
        command instanceof HeadObjectCommand
          ? head()
          : { VersionId: reference.objectVersion, Body: stream },
      ).read(documentId, "dispatch", reference),
    ).toEqual(bytes);
    expect(close).toHaveBeenCalledOnce();
    const invalid = {
      async *[Symbol.asyncIterator]() {
        yield "synthetic";
      },
    };
    await expect(
      service(async (command) =>
        command instanceof HeadObjectCommand
          ? head()
          : { VersionId: reference.objectVersion, Body: invalid },
      ).read(documentId, "dispatch", reference),
    ).rejects.toThrow(CoverLetterProviderTransportError);
  });
  it("aborts a stalled stream and refuses SDK errors with a fixed message", async () => {
    const controller = new AbortController();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    let began: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      began = resolve;
    });
    const stream = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            began();
            return new Promise<IteratorResult<Uint8Array>>(() => undefined);
          },
          return: close,
        };
      },
    };
    const reading = service(async (command) =>
      command instanceof HeadObjectCommand
        ? head()
        : { VersionId: reference.objectVersion, Body: stream },
    ).read(documentId, "dispatch", reference, controller.signal);
    const rejected = expect(reading).rejects.toThrow("CoverLetterProviderTransportRejected");
    await entered;
    controller.abort();
    await rejected;
    expect(close).toHaveBeenCalledOnce();
    await expect(
      service(async () => {
        throw Error("synthetic-private-candidate-data");
      }).putIfAbsent(documentId, "dispatch", bytes),
    ).rejects.toThrow("CoverLetterProviderTransportRejected");
  });
});

describe("precreated provider slot conditional transitions (offline S3)", () => {
  const setup = (slot: "dispatch" | "result", writeError?: unknown) => {
    const initial = encodeCoverLetterProviderObject(slot, {
      schemaVersion: 1,
      documentId,
      requestSha256: body.requestSha256,
      state: slot === "dispatch" ? "issued" : "pending",
    });
    const next = encodeCoverLetterProviderObject(slot, {
      ...body,
      state: slot === "dispatch" ? "claimed" : "ready",
      ...(slot === "result"
        ? {
            text: "Synthetic grounded output",
            model: COVER_LETTER_PROVIDER_MODEL,
            outputCharacters: 25,
          }
        : {}),
    });
    const ref = (data: Uint8Array, version: string) => ({
      objectVersion: version,
      etag: `"${coverLetterProviderSha256(data)}"`,
      sha256: coverLetterProviderSha256(data),
      sizeBytes: data.length,
    });
    const prior = ref(initial, "synthetic-initial");
    const ready = ref(next, "synthetic-next");
    let current = prior;
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        expect(command.input.Key).toBe(coverLetterProviderKey(documentId, slot));
        expect(command.input.IfMatch).toBe(prior.etag);
        expect(command.input.IfNoneMatch).toBeUndefined();
        expect(command.input.ServerSideEncryption).toBe("aws:kms");
        expect(command.input.SSEKMSKeyId).toBe(kms);
        expect(command.input.Body).toEqual(next);
        if (writeError) throw writeError;
        if (current.etag !== command.input.IfMatch) throw { name: "PreconditionFailed" };
        current = ready;
        return { VersionId: ready.objectVersion };
      }
      if (command instanceof HeadObjectCommand) {
        const pinned = command.input.VersionId === ready.objectVersion ? ready : prior;
        return {
          ...head(),
          VersionId: pinned.objectVersion,
          ETag: pinned.etag,
          ContentLength: pinned.sizeBytes,
          Metadata: {
            "document-id": documentId,
            "generation-slot": slot,
            "generation-sha256": pinned.sha256,
          },
        };
      }
      expect(command).toBeInstanceOf(GetObjectCommand);
      const version = (command as GetObjectCommand).input.VersionId;
      return { VersionId: version, Body: version === ready.objectVersion ? next : initial };
    });
    return { store: service(send), send, prior, ready, next };
  };
  it.each(["dispatch", "result"] as const)(
    "transitions owned %s only using its pinned ETag",
    async (slot) => {
      const fixture = setup(slot);
      expect(
        await fixture.store.transitionIfMatch(documentId, slot, fixture.prior, fixture.next),
      ).toEqual({ changed: true, reference: fixture.ready });
      expect(
        fixture.send.mock.calls.filter(([command]) => command instanceof PutObjectCommand),
      ).toHaveLength(1);
    },
  );
  it.each([404, 409, 412])(
    "never recreates/retries after a deletion or conflict (%s)",
    async (status) => {
      const fixture = setup("result", { $metadata: { httpStatusCode: status } });
      expect(
        await fixture.store.transitionIfMatch(documentId, "result", fixture.prior, fixture.next),
      ).toEqual({ changed: false });
      expect(
        fixture.send.mock.calls.filter(([command]) => command instanceof PutObjectCommand),
      ).toHaveLength(1);
    },
  );
  it("grants only one transition when duplicate invocations read the same historical placeholder", async () => {
    const fixture = setup("dispatch");
    const results = await Promise.all(
      [1, 2].map(() =>
        fixture.store.transitionIfMatch(documentId, "dispatch", fixture.prior, fixture.next),
      ),
    );
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(results.filter((result) => !result.changed)).toHaveLength(1);
  });
  it("refuses an already settled version without writing", async () => {
    const fixture = setup("result");
    await expect(
      fixture.store.transitionIfMatch(documentId, "result", fixture.ready, fixture.next),
    ).rejects.toThrow(CoverLetterProviderTransportError);
    expect(fixture.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
      false,
    );
  });
  it("refuses changed request identity or a mismatched pinned ETag before writing", async () => {
    const fixture = setup("dispatch");
    const foreign = encodeCoverLetterProviderObject("dispatch", {
      ...body,
      requestSha256: "b".repeat(64),
    });
    await expect(
      fixture.store.transitionIfMatch(documentId, "dispatch", fixture.prior, foreign),
    ).rejects.toThrow(CoverLetterProviderTransportError);
    await expect(
      fixture.store.transitionIfMatch(
        documentId,
        "dispatch",
        { ...fixture.prior, etag: '"foreign-etag"' },
        fixture.next,
      ),
    ).rejects.toThrow(CoverLetterProviderTransportError);
    expect(fixture.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
      false,
    );
  });
  it("does not convert authorization or ambiguous write errors to a retry/dispatch grant", async () => {
    for (const error of [{ name: "AccessDenied" }, Error("synthetic-private-error")]) {
      const fixture = setup("dispatch", error);
      await expect(
        fixture.store.transitionIfMatch(documentId, "dispatch", fixture.prior, fixture.next),
      ).rejects.toThrow("CoverLetterProviderTransportRejected");
      expect(
        fixture.send.mock.calls.filter(([command]) => command instanceof PutObjectCommand),
      ).toHaveLength(1);
    }
  });
  it("rejects invalid state and aborted work without SDK I/O", async () => {
    const fixture = setup("dispatch");
    const invalid = encodeCoverLetterProviderObject("dispatch", {
      schemaVersion: 1,
      documentId,
      requestSha256: body.requestSha256,
      state: "issued",
    });
    await expect(
      fixture.store.transitionIfMatch(documentId, "dispatch", fixture.prior, invalid),
    ).rejects.toThrow(CoverLetterProviderTransportError);
    await expect(
      fixture.store.transitionIfMatch(
        documentId,
        "dispatch",
        fixture.prior,
        fixture.next,
        AbortSignal.abort(),
      ),
    ).rejects.toThrow(CoverLetterProviderTransportError);
    expect(fixture.send).not.toHaveBeenCalled();
  });
});
