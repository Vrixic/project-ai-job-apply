import { describe, expect, it, vi } from "vitest";
import { forwardModeration, type ModerationBffDependencies, moderationId } from "./moderation-bff";

const JOB_ID = "018f92b0-4ad7-7b1d-8f44-b7ae694c85d1";
const CASE_ID = "018f92b0-4ad7-7b1d-8f44-b7ae694c85d2";

function dependencies(fetch: typeof globalThis.fetch): ModerationBffDependencies {
  return {
    getSession: async () => ({ user: {} }),
    getAccessToken: async () => ({ token: "server-held-token" }),
    fetch,
    baseUrl: "https://api.example.test",
  };
}

function request(body: unknown): Request {
  return new Request("https://admin.example.test/api/moderation/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin moderation BFF", () => {
  it("validates IDs before they can select an upstream route", () => {
    expect(moderationId(JOB_ID)).toBe(JOB_ID);
    expect(moderationId("../candidate-route")).toBeUndefined();
  });

  it("forwards only a strict request with the server-held token", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.example.test/v1/admin/moderation/cases");
      expect(init?.headers).toMatchObject({ authorization: "Bearer server-held-token" });
      return Response.json(
        {
          id: CASE_ID,
          target: { kind: "job", jobId: JOB_ID },
          status: "open",
          version: 0,
          openReasonCode: "candidate_reports",
          openedAt: "2026-08-22T12:00:00.000Z",
        },
        { status: 201 },
      );
    });
    const response = await forwardModeration(
      request({ target: { kind: "job", jobId: JOB_ID }, reasonCode: "candidate_reports" }),
      {
        path: "/v1/admin/moderation/cases",
        method: "POST",
        requestKind: "open",
        responseKind: "case",
      },
      dependencies(fetch as typeof globalThis.fetch),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).not.toHaveProperty("openedBy");
  });

  it("rejects unknown request fields before authentication or forwarding", async () => {
    const getSession = vi.fn(async () => ({ user: {} }));
    const fetch = vi.fn();
    const response = await forwardModeration(
      request({
        target: { kind: "job", jobId: JOB_ID },
        reasonCode: "candidate_reports",
        operatorId: "browser-injected",
      }),
      {
        path: "/v1/admin/moderation/cases",
        method: "POST",
        requestKind: "open",
        responseKind: "case",
      },
      { ...dependencies(fetch as typeof globalThis.fetch), getSession },
    );
    expect(response.status).toBe(400);
    expect(getSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when an upstream success includes an operator identity", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          id: CASE_ID,
          target: { kind: "job", jobId: JOB_ID },
          status: "open",
          version: 0,
          openReasonCode: "candidate_reports",
          openedAt: "2026-08-22T12:00:00.000Z",
          openedBy: "private-operator",
        },
        { status: 201 },
      ),
    );
    const response = await forwardModeration(
      request({ target: { kind: "job", jobId: JOB_ID }, reasonCode: "candidate_reports" }),
      {
        path: "/v1/admin/moderation/cases",
        method: "POST",
        requestKind: "open",
        responseKind: "case",
      },
      dependencies(fetch as typeof globalThis.fetch),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-operator");
  });

  it("does not forward without an authenticated admin session", async () => {
    const fetch = vi.fn();
    const response = await forwardModeration(
      request({ target: { kind: "job", jobId: JOB_ID }, reasonCode: "candidate_reports" }),
      {
        path: "/v1/admin/moderation/cases",
        method: "POST",
        requestKind: "open",
        responseKind: "case",
      },
      {
        ...dependencies(fetch as typeof globalThis.fetch),
        getSession: async () => null,
      },
    );
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
