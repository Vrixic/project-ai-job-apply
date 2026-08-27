import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardModeration } from "./moderation-bff";
import { moderationDependencies } from "./moderation-route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("admin moderation route dependencies", () => {
  it("fails closed when an identity-dark deployment has no Auth0 configuration", async () => {
    delete process.env.AUTH0_DOMAIN;
    delete process.env.AUTH0_CLIENT_ID;
    delete process.env.AUTH0_CLIENT_SECRET;
    delete process.env.AUTH0_SECRET;

    const response = await forwardModeration(
      new Request("https://admin.example.test/api/moderation/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: { kind: "job", jobId: "018f92b0-4ad7-7b1d-8f44-b7ae694c85d1" },
          reasonCode: "candidate_reports",
        }),
      }),
      {
        path: "/v1/admin/moderation/cases",
        method: "POST",
        requestKind: "open",
        responseKind: "case",
      },
      moderationDependencies(),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      code: "platform_unavailable",
      status: 503,
      title: "The platform API is unavailable",
    });
  });
});
