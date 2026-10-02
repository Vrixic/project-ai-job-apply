import { ModelGateway } from "@ai-job-apply/ai-sdk";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COVER_LETTER_PROVIDER_MODEL,
  type CoverLetterProviderInput,
  type CoverLetterProviderSlot,
  coverLetterProviderKey,
  coverLetterProviderSha256,
  decodeCoverLetterProviderObject,
  encodeCoverLetterProviderObject,
  validateCoverLetterProviderOutput,
} from "./cover-letter-provider-contract.js";
import { createCoverLetterIsolatedProviderHandler } from "./cover-letter-provider-handler.js";
import {
  coverLetterProviderTransitionPort,
  S3CoverLetterProviderObjects,
} from "./cover-letter-provider-objects.js";

const documentId = "019d04cf-1f80-7000-8000-000000000001";
const otherId = "019d04cf-1f80-7000-8000-000000000002";
const kms = "arn:aws:kms:us-east-2:123456789012:key/019d04cf-1f80-7000-8000-000000000003";
const request = {
  schemaVersion: 1,
  documentId,
  noticeVersion: "openai-cover-letter.v1",
  promptVersion: "1.0.0",
  jobContextHash: "a".repeat(64),
  confirmedFactsHash: "b".repeat(64),
  approvedAt: "2026-10-02T12:00:00.000Z",
  expiresAt: "2026-10-02T12:15:00.000Z",
  system: "Synthetic grounded rules",
  user: "Synthetic TypeScript career fact",
  maxOutputChars: 8_000,
};
const modelText = JSON.stringify({
  paragraphs: [{ text: "Synthetic TypeScript experience", factIds: [documentId] }],
});
interface Version {
  bytes: Uint8Array;
  version: string;
  etag: string;
  metadata: Record<string, string>;
}

async function fixture(
  settings: {
    defaultOff?: boolean;
    modelEnabled?: boolean;
    timeoutMs?: number;
    failAfterClaim?: boolean;
    failAfterResult?: boolean;
    refuseResult?: boolean;
    stallRead?: boolean;
    maxOutputChars?: number;
  } = {},
) {
  const versions = new Map<string, Version[]>();
  let serial = 0;
  let now = new Date("2026-10-02T12:01:00.000Z");
  let enabled = true;
  let afterClaim = () => undefined;
  let afterRequestRead = () => undefined;
  const slotFor = (objectKey: string) =>
    (["request", "dispatch", "result"] as const).find(
      (slot) => coverLetterProviderKey(documentId, slot) === objectKey,
    );
  const send = vi.fn(async (command: unknown): Promise<Record<string, unknown>> => {
    if (command instanceof PutObjectCommand) {
      const objectKey = command.input.Key as string;
      const slot = slotFor(objectKey);
      if (!slot || !(command.input.Body instanceof Uint8Array)) throw Error("SyntheticUnknownSlot");
      const history = versions.get(objectKey) ?? [];
      if (command.input.IfNoneMatch === "*" && history.length) throw { name: "PreconditionFailed" };
      if (
        command.input.IfMatch &&
        (!history.length || history.at(-1)?.etag !== command.input.IfMatch)
      )
        throw { $metadata: { httpStatusCode: history.length ? 412 : 404 } };
      if (slot === "result" && command.input.IfMatch && settings.refuseResult)
        throw { name: "AccessDenied" };
      const bytes = Uint8Array.from(command.input.Body);
      const version = {
        bytes,
        version: `synthetic-${++serial}`,
        etag: `"${coverLetterProviderSha256(bytes)}"`,
        metadata: command.input.Metadata ?? {},
      };
      versions.set(objectKey, [...history, version]);
      if (command.input.IfMatch && slot === "dispatch") {
        afterClaim();
        if (settings.failAfterClaim) {
          settings.failAfterClaim = false;
          throw Error("SyntheticLostClaimACK");
        }
      }
      if (command.input.IfMatch && slot === "result" && settings.failAfterResult) {
        settings.failAfterResult = false;
        throw Error("SyntheticLostResultACK");
      }
      return { VersionId: version.version, $metadata: { attempts: 1, httpStatusCode: 200 } };
    }
    if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) {
      const history = versions.get(command.input.Key as string) ?? [];
      const version = command.input.VersionId
        ? history.find((entry) => entry.version === command.input.VersionId)
        : history.at(-1);
      if (!version) throw { name: "NotFound" };
      if (command instanceof HeadObjectCommand)
        return {
          VersionId: version.version,
          ETag: version.etag,
          ContentLength: version.bytes.length,
          ContentType: "application/json",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: kms,
          Metadata: version.metadata,
        };
      if (slotFor(command.input.Key as string) === "request") {
        afterRequestRead();
        if (settings.stallRead) return new Promise(() => undefined);
      }
      return { VersionId: version.version, Body: Uint8Array.from(version.bytes) };
    }
    throw Error("SyntheticUnexpectedCommand");
  });
  const objects = new S3CoverLetterProviderObjects("synthetic-bucket", kms, {
    send,
    config: { maxAttempts: async () => 1 },
  });
  const requestBytes = encodeCoverLetterProviderObject("request", {
    ...request,
    maxOutputChars: settings.maxOutputChars ?? request.maxOutputChars,
  });
  const savedRequest = await objects.putIfAbsent(documentId, "request", requestBytes);
  const binding = { schemaVersion: 1, documentId, requestSha256: savedRequest.reference.sha256 };
  await objects.putIfAbsent(
    documentId,
    "dispatch",
    encodeCoverLetterProviderObject("dispatch", { ...binding, state: "issued" }),
  );
  await objects.putIfAbsent(
    documentId,
    "result",
    encodeCoverLetterProviderObject("result", { ...binding, state: "pending" }),
  );
  const complete = vi.fn(async () => ({ text: modelText }));
  const identity = { ...COVER_LETTER_PROVIDER_MODEL };
  const gateway = new ModelGateway(
    { identity, complete },
    {
      enabled: () => settings.modelEnabled !== false,
      clock: () => new Date(now),
      timeoutMs: 100,
    },
  );
  const port = coverLetterProviderTransitionPort(objects);
  const handler = createCoverLetterIsolatedProviderHandler({
    objects: port,
    gateway,
    ...(settings.defaultOff ? {} : { enabled: () => enabled }),
    clock: () => new Date(now),
    ...(settings.timeoutMs !== undefined ? { timeoutMs: settings.timeoutMs } : {}),
  });
  const input: CoverLetterProviderInput = {
    schemaVersion: 1,
    documentId,
    request: savedRequest.reference,
  };
  send.mockClear();
  const current = (slot: CoverLetterProviderSlot) => {
    const version = versions.get(coverLetterProviderKey(documentId, slot))?.at(-1);
    return version ? decodeCoverLetterProviderObject(slot, version.bytes) : undefined;
  };
  const overwrite = (slot: CoverLetterProviderSlot, value: unknown) => {
    const objectKey = coverLetterProviderKey(documentId, slot);
    const bytes = encodeCoverLetterProviderObject(slot, value);
    const valueVersion = {
      bytes,
      version: `synthetic-${++serial}`,
      etag: `"${coverLetterProviderSha256(bytes)}"`,
      metadata: {
        "document-id": documentId,
        "generation-slot": slot,
        "generation-sha256": coverLetterProviderSha256(bytes),
      },
    };
    versions.set(objectKey, [...(versions.get(objectKey) ?? []), valueVersion]);
  };
  return {
    handler,
    input,
    send,
    complete,
    port,
    identity,
    gateway,
    current,
    overwrite,
    setNow: (value: Date) => {
      now = value;
    },
    disable: () => {
      enabled = false;
    },
    afterClaim: (run: () => undefined) => {
      afterClaim = run;
    },
    afterRequestRead: (run: () => undefined) => {
      afterRequestRead = run;
    },
    remove: (slot: CoverLetterProviderSlot) => {
      versions.delete(coverLetterProviderKey(documentId, slot));
    },
  };
}

afterEach(() => vi.restoreAllMocks());
describe("isolated cover-letter provider handler (offline model and S3)", () => {
  it("is default-off before any SDK/model access and exposes no creation capability", async () => {
    const test = await fixture({ defaultOff: true });
    expect(await test.handler(test.input)).toEqual({
      schemaVersion: 1,
      documentId,
      outcome: "failed",
    });
    expect(test.send).not.toHaveBeenCalled();
    expect(test.complete).not.toHaveBeenCalled();
    expect(Object.keys(test.port).sort()).toEqual(["find", "read", "transitionIfMatch"]);
    expect(Object.isFrozen(test.port)).toBe(true);
  });
  it("claims before one gateway call, saves encrypted provenance and returns only a reference", async () => {
    const test = await fixture();
    test.complete.mockImplementation(async () => {
      expect(test.current("dispatch")).toMatchObject({ state: "claimed" });
      return { text: modelText };
    });
    const output = await test.handler(test.input);
    expect(validateCoverLetterProviderOutput(output)).toBe(true);
    expect(output).toMatchObject({ outcome: "ready" });
    expect(JSON.stringify(output)).not.toContain("TypeScript");
    expect(test.current("result")).toMatchObject({
      state: "ready",
      text: modelText,
      model: COVER_LETTER_PROVIDER_MODEL,
      outputCharacters: modelText.length,
    });
    expect(test.complete).toHaveBeenCalledOnce();
    expect(
      test.send.mock.calls.filter(([command]) => command instanceof PutObjectCommand),
    ).toHaveLength(2);
    for (const [command] of test.send.mock.calls)
      if (command instanceof PutObjectCommand) {
        expect(command.input.IfMatch).toBeDefined();
        expect(command.input.IfNoneMatch).toBeUndefined();
      }
  });
  it("recovers a ready result after consent expiry without renewing consent or calling again", async () => {
    const test = await fixture();
    const first = await test.handler(test.input);
    test.setNow(new Date("2026-10-02T12:30:00.000Z"));
    expect(await test.handler(test.input)).toEqual(first);
    expect(test.complete).toHaveBeenCalledOnce();
  });
  it("preserves the exact original fifteen-minute consent boundary", async () => {
    const test = await fixture();
    test.setNow(new Date(request.expiresAt));
    expect((await test.handler(test.input)).outcome).toBe("ready");
    expect(test.complete).toHaveBeenCalledOnce();
  });
  it("dispatches once across concurrent duplicate deliveries", async () => {
    const test = await fixture();
    const outputs = await Promise.all([test.handler(test.input), test.handler(test.input)]);
    expect(test.complete).toHaveBeenCalledOnce();
    expect(outputs.some((output) => output.outcome === "ready")).toBe(true);
    expect(outputs.every(validateCoverLetterProviderOutput)).toBe(true);
  });
  it("never dispatches after a claim acknowledgement is lost, including retry", async () => {
    const test = await fixture({ failAfterClaim: true });
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect(test.complete).not.toHaveBeenCalled();
  });
  it("recovers an encrypted result after its acknowledgement is lost without another model call", async () => {
    const test = await fixture({ failAfterResult: true });
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect((await test.handler(test.input)).outcome).toBe("ready");
    expect(test.complete).toHaveBeenCalledOnce();
  });
  it("does not regenerate when the model result could not be persisted", async () => {
    const test = await fixture({ refuseResult: true });
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect(test.complete).toHaveBeenCalledOnce();
  });
  it.each([
    new Date("2026-10-02T11:59:59.999Z"),
    new Date("2026-10-02T12:15:00.001Z"),
    new Date(Number.NaN),
  ])("refuses stale, future-approved or invalid time before claiming", async (now) => {
    const test = await fixture();
    test.setNow(now);
    expect((await test.handler(test.input)).outcome).toBe("failed");
    expect(test.complete).not.toHaveBeenCalled();
    expect(test.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
      false,
    );
  });
  it.each(["expiry", "disable"])(
    "rechecks %s after the claim and before provider access",
    async (change) => {
      const test = await fixture();
      test.afterClaim(() => {
        if (change === "expiry") test.setNow(new Date("2026-10-02T12:16:00.000Z"));
        else test.disable();
      });
      expect((await test.handler(test.input)).outcome).toBe("failed");
      expect(test.current("dispatch")).toMatchObject({ state: "claimed" });
      expect(test.complete).not.toHaveBeenCalled();
    },
  );
  it("preserves the gateway kill switch and declared smaller output bound", async () => {
    const disabled = await fixture({ modelEnabled: false });
    expect((await disabled.handler(disabled.input)).outcome).toBe("failed");
    expect(disabled.complete).not.toHaveBeenCalled();
    const smaller = await fixture({ maxOutputChars: 10 });
    expect((await smaller.handler(smaller.input)).outcome).toBe("failed");
    expect(smaller.current("result")).toMatchObject({ state: "pending" });
    expect(smaller.complete).toHaveBeenCalledOnce();
  });
  it("refuses a provider identity outside the approved disclosure before SDK access", async () => {
    const test = await fixture();
    Object.assign(test.identity, { model: "unapproved" });
    expect((await test.handler(test.input)).outcome).toBe("failed");
    expect(test.send).not.toHaveBeenCalled();
    expect(test.complete).not.toHaveBeenCalled();
  });
  it.each(["dispatch", "result"] as const)(
    "refuses missing %s instead of creating a replacement",
    async (slot) => {
      const test = await fixture();
      test.remove(slot);
      expect((await test.handler(test.input)).outcome).toBe("failed");
      expect(test.complete).not.toHaveBeenCalled();
      expect(test.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
        false,
      );
    },
  );
  it("never restores bytes after deletion during the model call", async () => {
    const test = await fixture();
    test.complete.mockImplementation(async () => {
      for (const slot of ["request", "dispatch", "result"] as const) test.remove(slot);
      return { text: modelText };
    });
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect((await test.handler(test.input)).outcome).toBe("failed");
    expect(test.current("result")).toBeUndefined();
    expect(test.complete).toHaveBeenCalledOnce();
  });
  it("refuses an owned slot bound to a different request hash", async () => {
    const test = await fixture();
    test.overwrite("result", {
      schemaVersion: 1,
      documentId,
      requestSha256: "c".repeat(64),
      state: "pending",
    });
    expect((await test.handler(test.input)).outcome).toBe("failed");
    expect(test.complete).not.toHaveBeenCalled();
  });
  it("refuses inconsistent recovered dispatch timestamps rather than generating again", async () => {
    const test = await fixture();
    await test.handler(test.input);
    test.overwrite("result", {
      ...test.current("result"),
      dispatchedAt: "2026-10-02T12:02:00.000Z",
    });
    expect((await test.handler(test.input)).outcome).toBe("failed");
    expect(test.complete).toHaveBeenCalledOnce();
  });
  it("snapshots input references across asynchronous reads", async () => {
    const test = await fixture();
    test.afterRequestRead(() => {
      test.input.documentId = otherId;
      test.input.request.sha256 = "c".repeat(64);
    });
    expect(await test.handler(test.input)).toMatchObject({ documentId, outcome: "ready" });
    expect(test.complete).toHaveBeenCalledOnce();
  });
  it("bounds stalled object transport without model access", async () => {
    const test = await fixture({ timeoutMs: 10, stallRead: true });
    expect((await test.handler(test.input)).outcome).toBe("failed");
    expect(test.complete).not.toHaveBeenCalled();
  });
  it("does not persist a late model response after the local deadline or generate again", async () => {
    const test = await fixture({ timeoutMs: 20 });
    let release: (value: { text: string }) => void = () => undefined;
    let entered: () => void = () => undefined;
    const began = new Promise<void>((resolve) => {
      entered = resolve;
    });
    test.complete.mockImplementation(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const running = test.handler(test.input);
    await began;
    expect((await running).outcome).toBe("in_progress");
    release({ text: modelText });
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect(test.current("result")).toMatchObject({ state: "pending" });
    expect(test.complete).toHaveBeenCalledOnce();
    expect(
      test.send.mock.calls.filter(([command]) => command instanceof PutObjectCommand),
    ).toHaveLength(1);
  });
  it("rejects malformed envelopes with only a fixed error and never evaluates accessors", async () => {
    const test = await fixture();
    const getter = vi.fn(() => documentId);
    const accessor = { ...test.input };
    Object.defineProperty(accessor, "documentId", { get: getter, enumerable: true });
    for (const input of [
      null,
      { ...test.input, text: "synthetic-private" },
      { ...test.input, documentId: "../foreign" },
      accessor,
    ])
      await expect(test.handler(input)).rejects.toThrow("CoverLetterProviderTransportRejected");
    expect(getter).not.toHaveBeenCalled();
    expect(test.send).not.toHaveBeenCalled();
  });
  it("does not log or reflect provider exceptions containing candidate values", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const infoLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const test = await fixture();
    test.complete.mockRejectedValue(Error("synthetic-private-candidate-text"));
    const output = await test.handler(test.input);
    expect(output).toEqual({ schemaVersion: 1, documentId, outcome: "failed" });
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });
});
