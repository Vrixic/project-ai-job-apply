import { describe, expect, it } from "vitest";
import { isProviderAccessRejected } from "./temporal-retirement-rejection.mjs";

describe("Temporal retirement rejection", () => {
  it.each([
    7,
    "PERMISSION_DENIED",
    16,
    "UNAUTHENTICATED",
  ])("accepts the provider access-rejection code %s", (code) => {
    expect(isProviderAccessRejected({ code })).toBe(true);
  });

  it.each([
    14,
    "UNAVAILABLE",
    undefined,
    null,
  ])("rejects transport or unclassified failures %s", (code) => {
    expect(isProviderAccessRejected(code === null ? null : { code })).toBe(false);
  });
});
