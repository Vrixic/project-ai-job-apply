import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/platform/operations/[operationId]/route";

const mocks = vi.hoisted(() => ({
  forwardPlatformRequest: vi.fn(),
  getLazyAuth0Session: vi.fn(() => ({ synthetic: "auth0-client" })),
}));

vi.mock("./platform-api", () => ({
  forwardPlatformRequest: mocks.forwardPlatformRequest,
}));

vi.mock("./auth0", () => ({
  getLazyAuth0Session: mocks.getLazyAuth0Session,
}));

const operationId = "019b4e12-7ea3-7c36-9357-aea35ab542cc";

function context(value = operationId) {
  return { params: Promise.resolve({ operationId: value }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("operation read route", () => {
  it("forwards the exact operation identity with the caller signal", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json({
        id: operationId,
        kind: "profile_readiness",
        state: "queued",
        result: {
          completionPercent: 100,
          missingFields: [],
          calculatedAt: "2026-08-17T12:00:00.000Z",
        },
        createdAt: "2026-08-17T12:00:00.000Z",
        updatedAt: "2026-08-17T12:00:00.000Z",
      }),
    );
    const controller = new AbortController();
    const request = new Request(`http://localhost/api/platform/operations/${operationId}`, {
      signal: controller.signal,
    });

    const response = await GET(request, context());

    expect(response.status).toBe(200);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledTimes(1);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      `/v1/operations/${operationId}`,
      { method: "GET", signal: request.signal },
      {
        auth0: { synthetic: "auth0-client" },
        baseUrl: "http://localhost:4000",
        fetch,
      },
    );
  });

  it("strips errorCode from operation success responses", async () => {
    const privateCanary = "candidate-private-operation-error-code";
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json({
        id: operationId,
        kind: "profile_readiness",
        state: "succeeded",
        result: {
          completionPercent: 100,
          missingFields: [],
          calculatedAt: "2026-08-17T12:00:00.000Z",
        },
        errorCode: privateCanary,
        createdAt: "2026-08-17T12:00:00.000Z",
        updatedAt: "2026-08-17T12:00:00.000Z",
      }),
    );
    const request = new Request(`http://localhost/api/platform/operations/${operationId}`);

    const response = await GET(request, context());
    const body = await response.text();
    const json = JSON.parse(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(json).toEqual({
      id: operationId,
      kind: "profile_readiness",
      state: "succeeded",
      result: {
        completionPercent: 100,
        missingFields: [],
        calculatedAt: "2026-08-17T12:00:00.000Z",
      },
      createdAt: "2026-08-17T12:00:00.000Z",
      updatedAt: "2026-08-17T12:00:00.000Z",
    });
    expect(json).not.toHaveProperty("errorCode");
    expect(body).not.toContain(privateCanary);
  });

  it("preserves an already-aborted caller signal", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json(
        {
          type: "urn:ai-job-apply:problem:platform_unavailable",
          title: "The platform API is unavailable",
          status: 503,
          code: "platform_unavailable",
        },
        { status: 503 },
      ),
    );
    const controller = new AbortController();
    controller.abort();
    const request = new Request(`http://localhost/api/platform/operations/${operationId}`, {
      signal: controller.signal,
    });

    await GET(request, context());

    const init = mocks.forwardPlatformRequest.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBe(request.signal);
    expect(init?.signal?.aborted).toBe(true);
  });

  it("rejects query input before authentication without reflecting it", async () => {
    const privateCanary = "candidate-private-operation-query";
    const response = await GET(
      new Request(
        `http://localhost/api/platform/operations/${operationId}?private=${privateCanary}`,
      ),
      context(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      type: "urn:ai-job-apply:problem:invalid_request",
      title: "Invalid request",
      status: 400,
      code: "invalid_request",
    });
    expect(body).not.toContain(privateCanary);
    expect(mocks.getLazyAuth0Session).not.toHaveBeenCalled();
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("preserves the fixed invalid-identifier failure without authentication or reflection", async () => {
    const privateCanary = "candidate-private-operation-id";
    const response = await GET(
      new Request(`http://localhost/api/platform/operations/${privateCanary}`),
      context(privateCanary),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      type: "urn:ai-job-apply:problem:invalid_request",
      title: "Invalid operation identifier",
      status: 400,
      code: "invalid_request",
    });
    expect(body).not.toContain(privateCanary);
    expect(mocks.getLazyAuth0Session).not.toHaveBeenCalled();
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });
});
