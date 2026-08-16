import { describe, expect, it } from "vitest";
import { retryDelayForAttempt } from "./backoff.js";

describe("retryDelayForAttempt", () => {
  it("grows exponentially, respects Retry-After, and caps the delay", () => {
    expect(retryDelayForAttempt(1)).toBe(1_000);
    expect(retryDelayForAttempt(4)).toBe(8_000);
    expect(retryDelayForAttempt(2, 30_000)).toBe(30_000);
    expect(retryDelayForAttempt(32, 24 * 60 * 60 * 1_000)).toBe(15 * 60 * 1_000);
  });

  it("rejects invalid attempts, Retry-After values, and policies", () => {
    expect(() => retryDelayForAttempt(0)).toThrow("between 1 and 32");
    expect(() => retryDelayForAttempt(1, -1)).toThrow("retry delay is invalid");
    expect(() =>
      retryDelayForAttempt(1, undefined, { baseDelayMs: 10, maximumDelayMs: 1 }),
    ).toThrow("policy is invalid");
  });
});
