import { describe, expect, it } from "vitest";
import { forwardTrust, type TrustBffDependencies, trustId } from "./trust-bff";

const CASE_ID = "019c0000-0000-8000-8000-000000000301";
const CONTRIBUTION_ID = "019c0000-0000-7000-8000-000000000302";

function request(body?: unknown): Request {
  return new Request("https://admin.example.test/api/trust/cases", {
    method: body ? "POST" : "GET",
    ...(body
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

function dependencies(fetch: typeof globalThis.fetch): TrustBffDependencies {
  return {
    getSession: async () => ({ user: {} }),
    getAccessToken: async () => ({ token: "server-held-token" }),
    fetch,
    baseUrl: "https://api.example.test",
  };
}

describe("Trust admin BFF", () => {
  it("accepts server-derived UUIDv8 case identifiers and rejects path traversal", () => {
    expect(trustId(CASE_ID)).toBe(CASE_ID);
    expect(trustId("../candidate-route")).toBeUndefined();
  });

  it("forwards a strict request with a server-held token and validates the response", async () => {
    const response = await forwardTrust(
      request({ contributionId: CONTRIBUTION_ID }),
      { path: "/v1/admin/trust/cases", method: "POST", requestKind: "open" },
      dependencies(async (input, init) => {
        expect(String(input)).toBe("https://api.example.test/v1/admin/trust/cases");
        expect(init?.headers).toMatchObject({ authorization: "Bearer server-held-token" });
        return Response.json(
          {
            id: CASE_ID,
            contributionId: CONTRIBUTION_ID,
            state: "needs_review",
            policyVersion: "d2-synthetic-policy.v1",
            version: 1,
            appealed: false,
            createdAt: "2026-09-01T12:00:00.000Z",
            updatedAt: "2026-09-01T12:00:00.000Z",
          },
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects raw evidence and malformed upstream identity fields", async () => {
    const invalid = await forwardTrust(
      request({
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "independently_verified",
        evidenceDigestSha256: "a".repeat(64),
        rawEvidence: "private allegation",
      }),
      { path: `/v1/admin/trust/cases/${CASE_ID}/decision`, method: "POST", requestKind: "decide" },
      dependencies(async () => {
        throw new Error("must not fetch");
      }),
    );
    expect(invalid.status).toBe(400);

    const malformed = await forwardTrust(
      request(),
      { path: `/v1/admin/trust/cases/${CASE_ID}`, method: "GET" },
      dependencies(async () =>
        Response.json(
          {
            id: CASE_ID,
            contributionId: CONTRIBUTION_ID,
            contributorUserId: CASE_ID,
          },
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    expect(malformed.status).toBe(503);
    expect(await malformed.text()).not.toContain("contributorUserId");
  });

  it("fails closed without a privileged session", async () => {
    const result = await forwardTrust(
      request(),
      { path: `/v1/admin/trust/cases/${CASE_ID}`, method: "GET" },
      { ...dependencies(fetch), getSession: async () => null },
    );
    expect(result.status).toBe(401);
  });

  it("forwards only a bounded fixed-state queue query and rejects duplicates or free text", async () => {
    const queued = await forwardTrust(
      new Request("https://admin.example.test/api/trust/cases?state=needs_review&pageSize=25"),
      { path: "/v1/admin/trust/cases", method: "GET", responseKind: "queue" },
      dependencies(async (input) => {
        expect(String(input)).toBe(
          "https://api.example.test/v1/admin/trust/cases?state=needs_review&pageSize=25",
        );
        return Response.json({ items: [] });
      }),
    );
    expect(queued.status).toBe(200);
    for (const query of [
      "state=needs_review&state=appeal_pending",
      "pageSize=26",
      "query=private",
      "cursor=../other",
      "pageSize=01",
    ]) {
      const denied = await forwardTrust(
        new Request(`https://admin.example.test/api/trust/cases?${query}`),
        { path: "/v1/admin/trust/cases", method: "GET", responseKind: "queue" },
        dependencies(async () => {
          throw new Error("Must not forward");
        }),
      );
      expect(denied.status).toBe(400);
    }
  });

  it("validates readable evidence and blocks extra contributor or raw-page fields", async () => {
    const value = {
      caseId: CASE_ID,
      caseVersion: 1,
      evidence: {
        contributionId: CONTRIBUTION_ID,
        evidenceDigestSha256: "a".repeat(64),
        verifiedAt: "2026-09-05T12:00:00.000Z",
        provider: "greenhouse",
        sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
        title: "Synthetic role",
        companyName: "Synthetic company",
        description: "Complete verified content",
        locations: [],
      },
    };
    const options = {
      path: `/v1/admin/trust/cases/${CASE_ID}/evidence`,
      method: "GET" as const,
      responseKind: "evidence" as const,
    };
    const accepted = await forwardTrust(
      request(),
      options,
      dependencies(async () => Response.json(value)),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual(value);
    for (const extra of [
      { contributorUserId: CONTRIBUTION_ID },
      { rawHtml: "private raw document" },
    ]) {
      const denied = await forwardTrust(
        request(),
        options,
        dependencies(async () =>
          Response.json({ ...value, evidence: { ...value.evidence, ...extra } }),
        ),
      );
      expect(denied.status).toBe(503);
      expect(await denied.text()).not.toContain("private raw document");
    }
  });
});
