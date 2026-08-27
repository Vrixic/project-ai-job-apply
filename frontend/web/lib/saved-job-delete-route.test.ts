import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../app/api/platform/saved-jobs/[savedJobId]/route";

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

const savedJobId = "019d04cf-1f80-7000-8000-000000000012";

function context(value = savedJobId) {
  return { params: Promise.resolve({ savedJobId: value }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saved-job delete route", () => {
  it("reprojects the exact 204 success as a bodyless no-store response", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      new Response(null, {
        status: 204,
        headers: { "cache-control": "private", "x-private-upstream": "candidate-private" },
      }),
    );
    const request = new Request(`http://localhost/api/platform/saved-jobs/${savedJobId}`, {
      method: "DELETE",
    });

    const response = await DELETE(request, context());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-private-upstream")).toBeNull();
    expect(await response.text()).toBe("");
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledTimes(1);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      `/v1/saved-jobs/${savedJobId}`,
      { method: "DELETE", signal: request.signal },
      {
        auth0: { synthetic: "auth0-client" },
        baseUrl: "http://localhost:4000",
        fetch,
      },
    );
  });

  it("contains and cancels a private unexpected success without awaiting hostile cancellation", async () => {
    const privateCanary = "candidate-private-delete-success";
    let cancellationRequested = false;
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(privateCanary));
          },
          cancel() {
            cancellationRequested = true;
            return new Promise<void>(() => undefined);
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await DELETE(
      new Request(`http://localhost/api/platform/saved-jobs/${savedJobId}`, {
        method: "DELETE",
      }),
      context(),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      type: "urn:ai-job-apply:problem:platform_unavailable",
      title: "The platform API is unavailable",
      status: 503,
      code: "platform_unavailable",
    });
    expect(body).not.toContain(privateCanary);
    expect(cancellationRequested).toBe(true);
  });

  it("rejects every other successful status even when it has no body", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(new Response(null, { status: 201 }));

    const response = await DELETE(
      new Request(`http://localhost/api/platform/saved-jobs/${savedJobId}`, {
        method: "DELETE",
      }),
      context(),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an already-sanitized non-success response unchanged", async () => {
    const upstream = Response.json(
      {
        type: "urn:ai-job-apply:problem:forbidden",
        title: "Forbidden",
        status: 403,
        code: "forbidden",
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
    mocks.forwardPlatformRequest.mockResolvedValueOnce(upstream);

    const response = await DELETE(
      new Request(`http://localhost/api/platform/saved-jobs/${savedJobId}`, {
        method: "DELETE",
      }),
      context(),
    );

    expect(response).toBe(upstream);
  });

  it("rejects query input before authentication without reflecting it", async () => {
    const privateCanary = "candidate-private-delete-query";
    const response = await DELETE(
      new Request(
        `http://localhost/api/platform/saved-jobs/${savedJobId}?private=${privateCanary}`,
        { method: "DELETE" },
      ),
      context(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).not.toContain(privateCanary);
    expect(mocks.getLazyAuth0Session).not.toHaveBeenCalled();
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid identifier before authentication without reflecting it", async () => {
    const privateCanary = "candidate-private-delete-id";
    const response = await DELETE(
      new Request(`http://localhost/api/platform/saved-jobs/${privateCanary}`, {
        method: "DELETE",
      }),
      context(privateCanary),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).not.toContain(privateCanary);
    expect(mocks.getLazyAuth0Session).not.toHaveBeenCalled();
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });
});
