import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PUT } from "../app/api/platform/restricted-answers/[fieldKey]/route";
import { GET } from "../app/api/platform/restricted-answers/route";

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

const fieldKey = "authorization.us_authorized";
const idempotencyKey = "restricted-answer-write-0001";
const body = JSON.stringify({
  expectedVersion: 0,
  valueType: "boolean",
  value: "true",
  sensitivity: "restricted",
  sourceReference: "candidate.settings",
  confirmedAt: "2026-09-29T12:00:00.000Z",
});
const metadata = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542d3",
  fieldKey,
  context: "jurisdiction.us",
  valueType: "boolean",
  sensitivity: "restricted",
  state: "active",
  version: 1,
  confirmedAt: "2026-09-29T12:00:00.000Z",
};

function request(
  method: "GET" | "PUT" | "DELETE",
  suffix = "",
  requestBody: BodyInit | null = method === "PUT" ? body : null,
): Request {
  const headers = new Headers();
  if (method === "PUT") {
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", idempotencyKey);
  }
  return new Request(`http://localhost/api/platform/restricted-answers/${fieldKey}${suffix}`, {
    method,
    headers,
    body: requestBody,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function context(value = fieldKey) {
  return { params: Promise.resolve({ fieldKey: value }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI", "enabled");
});

afterEach(() => vi.unstubAllEnvs());

describe("restricted answer BFF", () => {
  it("stays identity-dark and does not authenticate when the UI gate is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI", "disabled");

    const list = await GET(new Request("http://localhost/api/platform/restricted-answers"));
    const save = await PUT(request("PUT"), context());
    const remove = await DELETE(request("DELETE"), context());

    expect([list.status, save.status, remove.status]).toEqual([404, 404, 404]);
    expect(mocks.getLazyAuth0Session).not.toHaveBeenCalled();
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("forwards the metadata-only list through the server-held session", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json({ answers: [{ ...metadata, context: undefined }] }),
    );
    const candidate = new Request("http://localhost/api/platform/restricted-answers");

    const response = await GET(candidate);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledExactlyOnceWith(
      "/v1/profile/restricted-answers",
      { method: "GET", signal: candidate.signal },
      {
        auth0: { synthetic: "auth0-client" },
        baseUrl: "http://localhost:4000",
        fetch,
      },
    );
  });

  it("forwards one exact validated save without exposing the value in its response", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(Response.json(metadata));
    const candidate = request("PUT", "?context=jurisdiction.us");

    const response = await PUT(candidate, context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(metadata);
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledExactlyOnceWith(
      `/v1/profile/restricted-answers/${fieldKey}?context=jurisdiction.us`,
      {
        method: "PUT",
        body,
        signal: candidate.signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
      },
      {
        auth0: { synthetic: "auth0-client" },
        baseUrl: "http://localhost:4000",
        fetch,
      },
    );
  });

  it.each([
    ["an unknown field", fieldKey, "attestation.truthful", ""],
    ["an extra query", fieldKey, fieldKey, "?context=jurisdiction.us&private=1"],
    ["a duplicate context", fieldKey, fieldKey, "?context=a&context=b"],
    ["a malformed context", fieldKey, fieldKey, "?context=Jurisdiction%20US"],
  ])("rejects %s before authentication or forwarding", async (_label, _path, key, suffix) => {
    const response = await PUT(request("PUT", suffix), context(key));

    expect(response.status).toBe(400);
    expect(mocks.getLazyAuth0Session).not.toHaveBeenCalled();
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["a mismatched value type", { valueType: "enum" }],
    ["a weaker sensitivity", { sensitivity: "confidential" }],
    ["caller-controlled provenance", { sourceReference: "private.source" }],
    ["an expiry unsupported by this surface", { expiresAt: "2027-01-01T00:00:00.000Z" }],
    ["a non-boolean value", { value: "yes" }],
  ])("rejects %s without forwarding", async (_label, override) => {
    const response = await PUT(
      request("PUT", "", JSON.stringify({ ...JSON.parse(body), ...override })),
      context(),
    );

    expect(response.status).toBe(400);
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("contains an upstream response that tries to echo plaintext", async () => {
    const privateCanary = "synthetic-private-restricted-answer";
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json({ ...metadata, value: privateCanary }),
    );

    const response = await PUT(request("PUT", "?context=jurisdiction.us"), context());

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(privateCanary);
  });

  it("reprojects exact delete success as a bodyless no-store response", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const candidate = request("DELETE", "?context=jurisdiction.us");

    const response = await DELETE(candidate, context());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(mocks.forwardPlatformRequest).toHaveBeenCalledWith(
      `/v1/profile/restricted-answers/${fieldKey}?context=jurisdiction.us`,
      { method: "DELETE", signal: candidate.signal },
      expect.objectContaining({ auth0: { synthetic: "auth0-client" } }),
    );
  });

  it("rejects any delete body before authentication", async () => {
    const response = await DELETE(request("DELETE", "", "private-answer"), context());

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private-answer");
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });
});
