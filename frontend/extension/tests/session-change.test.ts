import { describe, expect, it } from "vitest";
import { isTokenRenewal } from "../lib/session-change";

describe("isTokenRenewal", () => {
  it("is true only for new tokens of the same account", () => {
    expect(
      isTokenRenewal({
        oldValue: { accessToken: "a", identityFence: "F" },
        newValue: { accessToken: "b", identityFence: "F" },
      }),
    ).toBe(true);
  });

  it.each([
    ["another account", { oldValue: { identityFence: "A" }, newValue: { identityFence: "B" } }],
    ["a sign-out", { oldValue: { identityFence: "A" } }],
    ["a first sign-in", { newValue: { identityFence: "A" } }],
    ["a session without a fence", { oldValue: { identityFence: "A" }, newValue: {} }],
    [
      "a fence that is not text",
      { oldValue: { identityFence: 1 }, newValue: { identityFence: 1 } },
    ],
    ["values that are not sessions", { oldValue: "A", newValue: "A" }],
    ["no change at all", undefined],
    ["an empty change", {}],
  ])("is false for %s", (_name, change) => {
    expect(isTokenRenewal(change)).toBe(false);
  });
});
