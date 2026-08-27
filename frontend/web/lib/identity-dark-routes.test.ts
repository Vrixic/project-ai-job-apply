import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getEntitlements } from "../app/api/platform/entitlements/route";
import { POST as postJobReport } from "../app/api/platform/jobs/[jobId]/reports/route";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => ({ token: "must-not-be-used" })),
  getSession: vi.fn(() => {
    throw new Error("private identity-dark configuration detail");
  }),
}));

vi.mock("./auth0", () => ({
  getLazyAuth0Session: () => ({
    getAccessToken: mocks.getAccessToken,
    getSession: mocks.getSession,
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("identity-dark candidate routes", () => {
  it("returns a sanitized non-cacheable 503 from the entitlement BFF", async () => {
    const response = await getEntitlements(
      new Request("https://candidate.example.test/api/platform/entitlements"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private identity-dark configuration detail");
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
  });

  it("keeps the report route inside the same fail-closed boundary", async () => {
    const response = await postJobReport(
      new Request("https://candidate.example.test/api/platform/jobs/synthetic/reports", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ jobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85d1" }),
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private identity-dark configuration detail");
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
  });
});
