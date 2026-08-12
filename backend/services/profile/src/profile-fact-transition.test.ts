import { describe, expect, it } from "vitest";
import { assertProfileFactTransition, ProfileFactTransitionConflictError } from "./index.js";

describe("profile fact transition policy", () => {
  it("requires an explicit candidate decision for every proposal", () => {
    expect(() => assertProfileFactTransition("proposed", "confirmed", false)).not.toThrow();
    expect(() => assertProfileFactTransition("proposed", "rejected", false)).not.toThrow();
    expect(() => assertProfileFactTransition("proposed", undefined, false)).toThrow(
      ProfileFactTransitionConflictError,
    );
  });

  it("allows correction only when the resulting value is confirmed", () => {
    expect(() => assertProfileFactTransition("proposed", "confirmed", true)).not.toThrow();
    expect(() => assertProfileFactTransition("confirmed", undefined, true)).not.toThrow();
    expect(() => assertProfileFactTransition("proposed", "rejected", true)).toThrow(
      ProfileFactTransitionConflictError,
    );
    expect(() => assertProfileFactTransition("rejected", undefined, true)).toThrow(
      ProfileFactTransitionConflictError,
    );
  });

  it("rejects every public mutation while a fact is system-unavailable", () => {
    expect(() => assertProfileFactTransition("confirmed", "confirmed", false, false)).toThrow(
      ProfileFactTransitionConflictError,
    );
  });
});
