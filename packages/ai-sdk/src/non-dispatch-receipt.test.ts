import { describe, expect, it, vi } from "vitest";
import { ModelGateway, ModelGatewayError } from "./gateway.js";

const identity = { provider: "offline-fake", model: "synthetic", version: "v1" };
const now = new Date("2026-10-03T12:00:00.000Z");
const request = {
  promptId: "synthetic",
  promptVersion: "v1",
  purpose: "cover_letter" as const,
  categories: ["profile_facts"] as const,
  system: "synthetic",
  user: "synthetic",
};
const disclosure = {
  purpose: "cover_letter" as const,
  categories: ["profile_facts"] as const,
  approvedAt: now,
};
const codes = [
  "MODEL_DISABLED",
  "DISCLOSURE_MISSING",
  "DISCLOSURE_PURPOSE_MISMATCH",
  "DISCLOSURE_CATEGORY_MISSING",
  "DISCLOSURE_STALE",
  "INPUT_TOO_LARGE",
] as const;

describe("original gateway non-dispatch receipts", () => {
  it("ordinary disabled generation refuses before consulting provider identity", async () => {
    const identityRead = vi.fn(() => {
      throw Error("SyntheticIdentityUnavailable");
    });
    const complete = vi.fn(async () => ({ text: "{}" }));
    const gateway = new ModelGateway(
      {
        get identity() {
          return identityRead();
        },
        complete,
      },
      {
        enabled: () => false,
      },
    );
    await expect(gateway.generate(request, disclosure)).rejects.toMatchObject({
      code: "MODEL_DISABLED",
    });
    expect(identityRead).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(codes)(
    "issues metadata only for local %s and preserves ordinary refusal",
    async (code) => {
      const complete = vi.fn(async () => ({ text: "{}" }));
      const completeForLifecycle = vi.fn(async () => ({ text: "{}" }));
      const gateway = new ModelGateway(
        { identity, complete, completeForLifecycle },
        {
          enabled: () => code !== "MODEL_DISABLED",
          clock: () => now,
          maxInputChars: code === "INPUT_TOO_LARGE" ? 0 : 40_000,
        },
      );
      const approval =
        code === "DISCLOSURE_MISSING"
          ? undefined
          : {
              ...disclosure,
              purpose:
                code === "DISCLOSURE_PURPOSE_MISMATCH"
                  ? ("narrative_answer" as const)
                  : disclosure.purpose,
              categories: code === "DISCLOSURE_CATEGORY_MISSING" ? [] : disclosure.categories,
              approvedAt: code === "DISCLOSURE_STALE" ? new Date(0) : now,
            };
      expect(await gateway.generateWithCompletion(request, approval)).toEqual({
        kind: "not_dispatched",
        code,
        model: identity,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
      });
      await expect(gateway.generate(request, approval)).rejects.toMatchObject({ code });
      expect(complete).not.toHaveBeenCalled();
      expect(completeForLifecycle).not.toHaveBeenCalled();
    },
  );
  it.each(codes)("never issues non-dispatch for provider-thrown %s", async (code) => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    const completeForLifecycle = vi.fn(async () => {
      throw new ModelGatewayError(code);
    });
    const gateway = new ModelGateway(
      { identity, complete, completeForLifecycle },
      {
        enabled: () => true,
        clock: () => now,
      },
    );
    await expect(gateway.generateWithCompletion(request, disclosure)).rejects.toMatchObject({
      code,
    });
    expect(completeForLifecycle).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });
  it("does not manufacture receipts from a thrown local callback", async () => {
    const complete = vi.fn(async () => ({ text: "{}" }));
    const gateway = new ModelGateway(
      { identity, complete },
      {
        enabled: () => {
          throw new ModelGatewayError("MODEL_DISABLED");
        },
      },
    );
    await expect(gateway.generateWithCompletion(request, disclosure)).rejects.toMatchObject({
      code: "MODEL_DISABLED",
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
