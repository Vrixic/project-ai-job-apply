import { describe, expect, it } from "vitest";
import { isIsolationOperationEligible } from "./isolation-operation";

describe("cross-user isolation operation eligibility", () => {
  it("accepts succeeded operations in every conformance mode", () => {
    expect(isIsolationOperationEligible("succeeded", false)).toBe(true);
    expect(isIsolationOperationEligible("succeeded", true)).toBe(true);
  });

  it("accepts queued operations only in explicit dark conformance", () => {
    expect(isIsolationOperationEligible("queued", false)).toBe(false);
    expect(isIsolationOperationEligible("queued", true)).toBe(true);
  });

  it.each(["running", "failed", undefined, null])("rejects ineligible state %s", (state) => {
    expect(isIsolationOperationEligible(state, true)).toBe(false);
  });
});
