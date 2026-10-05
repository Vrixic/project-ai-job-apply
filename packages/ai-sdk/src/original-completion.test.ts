import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway, ModelGatewayError, type ProviderRequest } from "./gateway.js";

const at = Date.parse("2026-10-05T12:00:00Z");
const identity = { provider: "offline-fake", model: "synthetic", version: "v1" };
const request = {
  promptId: "synthetic",
  promptVersion: "v1",
  purpose: "cover_letter" as const,
  categories: ["profile_facts"] as const,
  system: "",
  user: "",
};
const disclosure = { ...request, approvedAt: new Date(at) };
afterEach(() => vi.useRealTimers());

describe("original foreground completion lifetime", () => {
  it("captures original fulfillment time and preserves ordinary receipt compatibility", async () => {
    let now = at;
    const provider = {
      identity,
      complete: vi.fn(async () => {
        now += 41;
        return { text: "{}" };
      }),
    };
    const gateway = new ModelGateway(provider, { enabled: () => true, clock: () => new Date(now) });
    expect(await gateway.generateOriginalWithCompletion(request, disclosure)).toMatchObject({
      kind: "completed",
      completedAtMs: at + 41,
      result: { value: {} },
    });
    expect(await gateway.generateWithCompletion(request, disclosure)).not.toHaveProperty(
      "completedAtMs",
    );
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("holds the original promise through timeout and discards late fulfilled content", async () => {
    vi.useFakeTimers();
    let resolve!: (result: { text: string }) => void;
    let dispatched: ProviderRequest | undefined;
    const complete = vi.fn((input: ProviderRequest) => {
      dispatched = input;
      return new Promise<{ text: string }>((done) => {
        resolve = done;
      });
    });
    const gateway = new ModelGateway(
      { identity, complete },
      {
        enabled: () => true,
        timeoutMs: 10,
        clock: () => new Date(at),
      },
    );
    let settled = false;
    const original = gateway.generateOriginalWithCompletion(request, disclosure).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(dispatched?.signal.aborted).toBe(true);
    expect(settled).toBe(false);
    resolve({
      text: JSON.stringify({ paragraphs: [{ text: "Synthetic late content", factIds: [] }] }),
    });
    expect(await original).toEqual({
      kind: "completed_discarded",
      completedAtMs: at,
      model: identity,
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each(["not-json", "x".repeat(8_001)])(
    "timestamps only positive rejected fulfillment",
    async (text) => {
      const gateway = new ModelGateway(
        { identity, complete: async () => ({ text }) },
        {
          enabled: () => true,
          clock: () => new Date(at),
        },
      );
      const result = await gateway.generateOriginalWithCompletion(request, disclosure);
      expect(result).toMatchObject({ kind: "completed_rejected", completedAtMs: at });
      expect(result).not.toHaveProperty("text");
      expect(result).not.toHaveProperty("result");
    },
  );

  it("unknown provider rejection remains unresolved without fallback", async () => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    const completeForLifecycle = vi.fn(async () => {
      throw Error("SensitiveProviderBody");
    });
    const gateway = new ModelGateway(
      { identity, complete, completeForLifecycle },
      {
        enabled: () => true,
        clock: () => new Date(at),
      },
    );
    await expect(gateway.generateOriginalWithCompletion(request, disclosure)).rejects.toEqual(
      new ModelGatewayError("PROVIDER_FAILED"),
    );
    expect(completeForLifecycle).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it("local refusal has no completion timestamp and never invokes the provider", async () => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    const gateway = new ModelGateway({ identity, complete }, { enabled: () => false });
    const result = await gateway.generateOriginalWithCompletion(request, disclosure);
    expect(result.kind).toBe("not_dispatched");
    expect(result).not.toHaveProperty("completedAtMs");
    expect(complete).not.toHaveBeenCalled();
  });
});
