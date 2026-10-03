import { ModelGateway, ModelGatewayError, OpenAiLunaProvider } from "@ai-job-apply/ai-sdk";
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
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

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
    withoutWork?: boolean;
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
  const originalRequestSha256 = savedRequest.reference.sha256;
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
  let workClaimed = false;
  const work = {
    claimProviderDispatch: vi.fn<PostgresCoverLetterWorkStore["claimProviderDispatch"]>(
      async (binding) => {
        expect(binding).toEqual({
          documentId,
          requestSha256: originalRequestSha256,
          consentExpiresAt: new Date(request.expiresAt),
        });
        if (workClaimed) return { kind: "unavailable" };
        workClaimed = true;
        return {
          kind: "claimed",
          reference: {
            id: otherId,
            documentId,
            purpose: "provider_dispatch",
            requestSha256: binding.requestSha256,
          },
        };
      },
    ),
    settleProviderDispatch: vi.fn<PostgresCoverLetterWorkStore["settleProviderDispatch"]>(
      async () => undefined,
    ),
    settleRejectedProviderDispatch: vi.fn<
      PostgresCoverLetterWorkStore["settleRejectedProviderDispatch"]
    >(async () => undefined),
  };
  const handler = createCoverLetterIsolatedProviderHandler({
    objects: port,
    gateway,
    ...(settings.withoutWork ? {} : { work }),
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
    work,
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
  it.each([
    { kind: "invalid_json", text: "not json", status: "completed", closes: true },
    { kind: "oversized", text: "x".repeat(8_001), status: "completed", closes: true },
    { kind: "incomplete", text: "not json", status: "incomplete", closes: false },
  ])(
    "actual offline adapter $kind reaches only the appropriate original-phase closure",
    async ({ text, status, closes }) => {
      const test = await fixture();
      const transport = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            status,
            output: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text }],
              },
            ],
          }),
        ),
      );
      const clock = () => new Date("2026-10-02T12:01:00.000Z");
      const gateway = new ModelGateway(
        new OpenAiLunaProvider({
          enabled: () => true,
          apiKey: () => "synthetic",
          fetch: transport,
        }),
        { enabled: () => true, clock },
      );
      const handler = createCoverLetterIsolatedProviderHandler({
        objects: test.port,
        gateway,
        work: test.work,
        enabled: () => true,
        clock,
      });
      expect((await handler(test.input)).outcome).toBe("failed");
      expect(transport).toHaveBeenCalledOnce();
      expect(test.work.settleRejectedProviderDispatch).toHaveBeenCalledTimes(closes ? 1 : 0);
      expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(test.current("result")).toMatchObject({ state: "pending" });
      expect((await handler(test.input)).outcome).toBe("in_progress");
      expect(transport).toHaveBeenCalledOnce();
    },
  );
  it.each(["model", "prompt", "version", "negative", "fractional", "code"])(
    "refuses an unbound %s completion receipt without closing work",
    async (kind) => {
      const test = await fixture();
      const receipt = {
        kind: "completed_rejected" as const,
        code: "OUTPUT_NOT_JSON" as const,
        model: { ...COVER_LETTER_PROVIDER_MODEL } as {
          provider: string;
          model: string;
          version: string;
        },
        promptId: "cover_letter",
        promptVersion: request.promptVersion,
        outputCharacters: 8,
      };
      if (kind === "model") receipt.model.model = "unapproved";
      if (kind === "prompt") receipt.promptId = "other";
      if (kind === "version") receipt.promptVersion = "other";
      if (kind === "negative") receipt.outputCharacters = -1;
      if (kind === "fractional") receipt.outputCharacters = 0.5;
      if (kind === "code") Object.assign(receipt, { code: "PROVIDER_TIMEOUT" });
      vi.spyOn(test.gateway, "generateWithCompletion").mockResolvedValue(receipt);
      expect((await test.handler(test.input)).outcome).toBe("in_progress");
      expect(test.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
      expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(test.current("result")).toMatchObject({ state: "pending" });
    },
  );
  it("does not start rejection cleanup after activation is withdrawn during completion", async () => {
    const test = await fixture();
    test.complete.mockImplementation(async () => {
      test.disable();
      return { text: "not json" };
    });
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect(test.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
  });
  it.each(["not json", "x".repeat(8_001)])(
    "fences only positively completed rejected output without a result write",
    async (text) => {
      const test = await fixture();
      test.complete.mockResolvedValue({ text });
      expect((await test.handler(test.input)).outcome).toBe("failed");
      expect(test.complete).toHaveBeenCalledOnce();
      expect(test.work.settleRejectedProviderDispatch).toHaveBeenCalledOnce();
      expect(test.work.settleRejectedProviderDispatch).toHaveBeenCalledWith({
        id: otherId,
        documentId,
        purpose: "provider_dispatch",
        requestSha256: test.input.request.sha256,
      });
      expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(test.current("result")).toMatchObject({ state: "pending" });
      expect((await test.handler(test.input)).outcome).toBe("in_progress");
      expect(test.complete).toHaveBeenCalledOnce();
      expect(test.work.settleRejectedProviderDispatch).toHaveBeenCalledOnce();
    },
  );
  it.each(["MODEL_DISABLED", "OUTPUT_NOT_JSON", "OUTPUT_TOO_LARGE", "PROVIDER_TIMEOUT"] as const)(
    "provider-thrown %s never permits rejected-phase closure",
    async (code) => {
      const test = await fixture();
      test.complete.mockRejectedValue(new ModelGatewayError(code));
      expect((await test.handler(test.input)).outcome).toBe("failed");
      expect(test.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
      expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(test.current("result")).toMatchObject({ state: "pending" });
    },
  );
  it("lost rejected-phase closure acknowledgement remains unresolved without retry", async () => {
    const test = await fixture();
    test.complete.mockResolvedValue({ text: "not json" });
    test.work.settleRejectedProviderDispatch.mockRejectedValue(Error("SyntheticLostClosureACK"));
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect(test.complete).toHaveBeenCalledOnce();
    expect(test.work.settleRejectedProviderDispatch).toHaveBeenCalledOnce();
    expect(test.current("result")).toMatchObject({ state: "pending" });
  });
  it("an expired local deadline never closes a late original rejected response", async () => {
    const test = await fixture({ timeoutMs: 20 });
    let finish: (value: { text: string }) => void = () => undefined;
    test.complete.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    finish({ text: "not json" });
    await Promise.resolve();
    expect(test.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
    expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
  });
  it("a missing new control capability fails closed on older compositions", async () => {
    const test = await fixture();
    test.complete.mockResolvedValue({ text: "not json" });
    const handler = createCoverLetterIsolatedProviderHandler({
      objects: test.port,
      gateway: test.gateway,
      work: {
        claimProviderDispatch: test.work.claimProviderDispatch,
        settleProviderDispatch: test.work.settleProviderDispatch,
      },
      enabled: () => true,
      clock: () => new Date("2026-10-02T12:01:00.000Z"),
    });
    expect((await handler(test.input)).outcome).toBe("in_progress");
    expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
    expect(test.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
  });
  it("refuses missing control authority before all object/model access", async () => {
    const test = await fixture({ withoutWork: true });
    expect((await test.handler(test.input)).outcome).toBe("failed");
    expect(test.send).not.toHaveBeenCalled();
    expect(test.complete).not.toHaveBeenCalled();
  });

  it.each(["denied", "lost_ack"])("does not dispatch after a %s ledger claim", async (reason) => {
    const test = await fixture();
    if (reason === "denied")
      test.work.claimProviderDispatch.mockResolvedValue({ kind: "unavailable" });
    else
      test.work.claimProviderDispatch.mockRejectedValue(
        new Error("Synthetic private control diagnostic"),
      );
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect(test.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
      false,
    );
    expect(test.complete).not.toHaveBeenCalled();
    expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
  });

  it.each(["identity", "document", "purpose", "digest"])(
    "rejects a mismatched %s ledger receipt before dispatch",
    async (change) => {
      const test = await fixture();
      const claim = test.work.claimProviderDispatch.getMockImplementation();
      if (!claim) throw new Error("Synthetic claim missing");
      test.work.claimProviderDispatch.mockImplementation(async (binding) => {
        const result = await claim(binding);
        if (result.kind !== "claimed") return result;
        if (change === "identity") result.reference.id = "invalid";
        if (change === "document") result.reference.documentId = otherId;
        if (change === "purpose") result.reference.purpose = "final_document";
        if (change === "digest") result.reference.requestSha256 = "f".repeat(64);
        return result;
      });
      expect((await test.handler(test.input)).outcome).toBe("in_progress");
      expect(test.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
        false,
      );
      expect(test.complete).not.toHaveBeenCalled();
      expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
    },
  );

  it.each(["timeout", "disable", "expiry"])(
    "waits for original control acknowledgement but refuses effects after %s",
    async (change) => {
      const test = await fixture({ ...(change === "timeout" ? { timeoutMs: 20 } : {}) });
      const claim = test.work.claimProviderDispatch.getMockImplementation();
      if (!claim) throw new Error("Synthetic claim missing");
      test.work.claimProviderDispatch.mockImplementation(async (binding) => {
        const result = await claim(binding);
        if (change === "timeout") await new Promise((resolve) => setTimeout(resolve, 40));
        if (change === "disable") test.disable();
        if (change === "expiry") test.setNow(new Date("2026-10-02T12:16:00.000Z"));
        return result;
      });
      expect((await test.handler(test.input)).outcome).toBe("in_progress");
      expect(test.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(
        false,
      );
      expect(test.complete).not.toHaveBeenCalled();
      expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
    },
  );

  it("does not repeat settlement after its acknowledgement fails or after read-only recovery", async () => {
    const test = await fixture();
    test.work.settleProviderDispatch.mockRejectedValue(new Error("Synthetic ambiguous settlement"));
    expect((await test.handler(test.input)).outcome).toBe("in_progress");
    expect((await test.handler(test.input)).outcome).toBe("ready");
    expect(test.work.claimProviderDispatch).toHaveBeenCalledOnce();
    expect(test.work.settleProviderDispatch).toHaveBeenCalledOnce();
    expect(test.complete).toHaveBeenCalledOnce();
  });

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
    expect(test.work.claimProviderDispatch).toHaveBeenCalledOnce();
    expect(test.work.settleProviderDispatch).toHaveBeenCalledOnce();
    const writes = test.send.mock.calls.flatMap(([command], index) =>
      command instanceof PutObjectCommand ? [test.send.mock.invocationCallOrder[index] ?? 0] : [],
    );
    expect(test.work.claimProviderDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      writes[0] ?? 0,
    );
    expect(test.work.settleProviderDispatch.mock.invocationCallOrder[0]).toBeGreaterThan(
      writes[1] ?? 0,
    );
    await test.handler(test.input);
    expect(test.work.claimProviderDispatch).toHaveBeenCalledOnce();
    expect(test.work.settleProviderDispatch).toHaveBeenCalledOnce();
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
    expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
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
    expect(disabled.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
    const smaller = await fixture({ maxOutputChars: 10 });
    expect((await smaller.handler(smaller.input)).outcome).toBe("failed");
    expect(smaller.current("result")).toMatchObject({ state: "pending" });
    expect(smaller.complete).toHaveBeenCalledOnce();
    expect(smaller.work.settleRejectedProviderDispatch).toHaveBeenCalledOnce();
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
    expect(test.work.settleProviderDispatch).not.toHaveBeenCalled();
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
