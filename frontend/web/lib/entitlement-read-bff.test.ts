import { describe, expect, it } from "vitest";
import { validateEntitlementReadRequest } from "./entitlement-read-bff";

describe("entitlement read BFF boundary", () => {
  it("accepts only an exact bodyless GET and ignores caller headers", () => {
    const request = new Request("https://web.example.test/api/platform/entitlements", {
      method: "GET",
      headers: { "x-owner-id": "must-not-be-forwarded" },
    });
    expect(validateEntitlementReadRequest(request)).toBeUndefined();
  });

  it("rejects query and non-GET input without reflecting it", async () => {
    for (const request of [
      new Request("https://web.example.test/api/platform/entitlements?owner=private-value"),
      new Request("https://web.example.test/api/platform/entitlements", { method: "POST" }),
    ]) {
      const failure = validateEntitlementReadRequest(request);
      expect(failure?.status).toBe(400);
      expect(failure?.headers.get("cache-control")).toBe("no-store");
      expect(await failure?.text()).not.toContain("private-value");
    }
  });
});
