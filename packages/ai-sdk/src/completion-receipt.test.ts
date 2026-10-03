import { describe, expect, it, vi } from "vitest";
import { ModelGateway, ModelGatewayError } from "./gateway.js";

const identity = { provider: "offline-fake", model: "synthetic", version: "v1" };
const request = {
  promptId: "synthetic",
  promptVersion: "v1",
  purpose: "cover_letter" as const,
  categories: ["profile_facts"] as const,
  system: "",
  user: "",
};
const disclosure = {
  purpose: "cover_letter" as const,
  categories: ["profile_facts"] as const,
  approvedAt: new Date(),
};

describe("internal original-provider completion receipts", () => {
  it("pins original prompt and model provenance before asynchronous dispatch", async () => {
    const originalRequest = { ...request };
    const originalIdentity = { ...identity };
    let finish: (value: { text: string }) => void = () => undefined;
    const gateway = new ModelGateway(
      {
        identity: originalIdentity,
        complete: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
      { enabled: () => true },
    );
    const pending = gateway.generateWithCompletion(originalRequest, disclosure);
    originalRequest.promptVersion = "changed";
    originalIdentity.version = "changed";
    finish({ text: "not json" });
    expect(await pending).toMatchObject({ model: identity, promptVersion: request.promptVersion });
  });
  it("malformed original fulfillment is not an acknowledged completion receipt", async () => {
    const gateway = new ModelGateway(
      { identity, complete: async () => ({ text: undefined as unknown as string }) },
      { enabled: () => true },
    );
    await expect(gateway.generateWithCompletion(request, disclosure)).rejects.toMatchObject({
      code: "PROVIDER_FAILED",
    });
  });
  it.each([
    ["not json", "OUTPUT_NOT_JSON"],
    ["x".repeat(9), "OUTPUT_TOO_LARGE"],
  ] as const)(
    "retains content-free positive completion metadata after %s rejection",
    async (text, code) => {
      const complete = vi.fn(async () => ({ text }));
      const gateway = new ModelGateway(
        { identity, complete },
        { enabled: () => true, maxOutputChars: 8 },
      );
      const receipt = await gateway.generateWithCompletion(request, disclosure);
      expect(receipt).toEqual({
        kind: "completed_rejected",
        code,
        model: identity,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        outputCharacters: text.length,
      });
      expect(complete).toHaveBeenCalledOnce();
      expect(JSON.stringify(receipt)).not.toContain(text);
    },
  );
  it("keeps the ordinary successful result and positive completion separate from approval", async () => {
    const gateway = new ModelGateway(
      { identity, complete: async () => ({ text: "{}" }) },
      { enabled: () => true },
    );
    const receipt = await gateway.generateWithCompletion(request, disclosure);
    expect(receipt).toEqual({
      kind: "completed",
      result: {
        value: {},
        model: identity,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        outputCharacters: 2,
      },
    });
  });
  it.each(["MODEL_DISABLED", "OUTPUT_NOT_JSON", "OUTPUT_TOO_LARGE", "PROVIDER_FAILED"] as const)(
    "a provider-thrown %s is not positive completion",
    async (code) => {
      const complete = vi.fn(async () => {
        throw new ModelGatewayError(code);
      });
      const gateway = new ModelGateway({ identity, complete }, { enabled: () => true });
      await expect(gateway.generateWithCompletion(request, disclosure)).rejects.toMatchObject({
        code,
      });
      expect(complete).toHaveBeenCalledOnce();
    },
  );
  it("a local refusal does not produce an original response receipt", async () => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    const gateway = new ModelGateway({ identity, complete }, { enabled: () => false });
    await expect(gateway.generateWithCompletion(request, disclosure)).rejects.toMatchObject({
      code: "MODEL_DISABLED",
    });
    expect(complete).not.toHaveBeenCalled();
  });
  it("late response after a local timeout never becomes a completion receipt", async () => {
    let finish: (value: { text: string }) => void = () => undefined;
    const original = new Promise<{ text: string }>((resolve) => {
      finish = resolve;
    });
    const gateway = new ModelGateway(
      { identity, complete: () => original },
      { enabled: () => true, timeoutMs: 5 },
    );
    const attempt = gateway.generateWithCompletion(request, disclosure);
    await expect(attempt).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    finish({ text: "not json" });
    await expect(attempt).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
  it.each([
    ["not json", "OUTPUT_NOT_JSON"],
    ["x".repeat(9), "OUTPUT_TOO_LARGE"],
  ] as const)("ordinary generate preserves the existing %s error contract", async (text, code) => {
    const gateway = new ModelGateway(
      { identity, complete: async () => ({ text }) },
      { enabled: () => true, maxOutputChars: 8 },
    );
    await expect(gateway.generate(request, disclosure)).rejects.toMatchObject({ code });
  });
});
