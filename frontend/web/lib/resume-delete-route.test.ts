import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../app/api/platform/resumes/[documentId]/route";

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

const documentId = "019d04cf-1f80-7000-8000-000000000012";

function context(value = documentId) {
  return { params: Promise.resolve({ documentId: value }) };
}

function deleteRequest(path = documentId) {
  return new Request(`http://localhost/api/platform/resumes/${path}`, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resume delete route (ADR-033)", () => {
  it("reprojects the exact 204 success as a bodyless no-store response", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      new Response(null, {
        status: 204,
        headers: { "cache-control": "private", "x-private-upstream": "candidate-private" },
      }),
    );
    const request = deleteRequest();

    const response = await DELETE(request, context());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-private-upstream")).toBeNull();
    expect(await response.text()).toBe("");
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledExactlyOnceWith(
      `/v1/resumes/${documentId}`,
      { method: "DELETE", signal: request.signal },
      {
        auth0: { synthetic: "auth0-client" },
        baseUrl: "http://localhost:4000",
        fetch,
      },
    );
  });

  it("contains and cancels a private unexpected success without awaiting hostile cancellation", async () => {
    const privateCanary = "candidate-private-resume-delete-success";
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

    const response = await DELETE(deleteRequest(), context());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ code: "platform_unavailable", status: 503 });
    expect(body).not.toContain(privateCanary);
    expect(cancellationRequested).toBe(true);
  });

  it("returns an already-sanitized refusal, such as a resume still processing, unchanged", async () => {
    const upstream = Response.json(
      {
        type: "urn:ai-job-apply:problem:resume_not_deletable",
        title: "A resume is still being processed",
        status: 409,
        code: "resume_not_deletable",
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
    mocks.forwardPlatformRequest.mockResolvedValueOnce(upstream);

    expect(await DELETE(deleteRequest(), context())).toBe(upstream);
  });

  it.each([
    ["a query string", `${documentId}?private=candidate-private-query`, documentId],
    ["a malformed identifier", "not-a-uuid", "not-a-uuid"],
    [
      "a version 4 identifier",
      "6f9619ff-8b86-4011-b42d-00c04fc964ff",
      "6f9619ff-8b86-4011-b42d-00c04fc964ff",
    ],
  ])("rejects %s before reaching the platform, without reflecting it", async (_name, path, id) => {
    const response = await DELETE(deleteRequest(path), context(id));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("candidate-private-query");
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });
});
