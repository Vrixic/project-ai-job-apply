import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH, DELETE } from "../app/api/platform/profile/[section]/[recordId]/route";
import { POST as postSave } from "../app/api/platform/profile/[section]/[recordId]/save/route";
import { POST as postReorder } from "../app/api/platform/profile/[section]/reorder/route";
import {
  GET as getSection,
  POST as postSection,
} from "../app/api/platform/profile/[section]/route";
import { GET as getPersonal, PUT as putPersonal } from "../app/api/platform/profile/personal/route";

const mocks = vi.hoisted(() => ({
  forwardPlatformRequest: vi.fn(),
  getLazyAuth0Session: vi.fn(() => ({ synthetic: "auth0-client" })),
}));

vi.mock("./platform-api", () => ({ forwardPlatformRequest: mocks.forwardPlatformRequest }));
vi.mock("./auth0", () => ({ getLazyAuth0Session: mocks.getLazyAuth0Session }));

beforeEach(() => {
  vi.clearAllMocks();
});

const id = "019d04cf-1f80-7000-8000-000000000002";
const key = "profile-bff-test-0001";
const at = "2026-10-22T12:00:00.000Z";
const record = {
  id,
  name: "TypeScript",
  version: 1,
  origin: "entered",
  displayOrder: 0,
  createdAt: at,
  updatedAt: at,
};

const params = (value: Record<string, string>) => ({ params: Promise.resolve(value) });
const jsonRequest = (method: string, url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });

describe("structured Profile BFF boundary (ADR-052)", () => {
  it("reaches only the fixed sections and forwards nothing for an unknown one", async () => {
    for (const section of ["facts", "resumes", "..%2Ffacts", "constructor", "import-drafts"]) {
      const response = await postSection(
        jsonRequest("POST", `/api/platform/profile/${section}`, { name: "x" }),
        params({ section }),
      );
      expect(response.status, section).toBe(404);
    }
    expect(
      (await getSection(new Request("http://localhost/x"), params({ section: "nope" }))).status,
    ).toBe(404);
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("forwards a valid create to the fixed Gateway path with its idempotency key and validates the answer", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(Response.json(record, { status: 201 }));
    const response = await postSection(
      jsonRequest("POST", "/api/platform/profile/skill-entries", { name: "TypeScript" }),
      params({ section: "skill-entries" }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [path, init] = mocks.forwardPlatformRequest.mock.calls[0] ?? [];
    expect(path).toBe("/v1/profile/skill-entries");
    expect(init).toMatchObject({ method: "POST", headers: { "idempotency-key": key } });
  });

  it("refuses unknown fields, missing keys and oversized or malformed bodies before forwarding", async () => {
    const section = params({ section: "skill-entries" });
    for (const body of [{ name: "Go", sensitivity: "restricted" }, { name: "" }, {}, []]) {
      expect((await postSection(jsonRequest("POST", "/x", body), section)).status).toBe(400);
    }
    const noKey = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Go" }),
    });
    expect((await postSection(noKey, section)).status).toBe(400);
    expect((await postSection(jsonRequest("POST", "/x?x=1", { name: "Go" }), section)).status).toBe(
      400,
    );
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("validates record identifiers on update and refuses a response that breaks its contract", async () => {
    const bad = await PATCH(
      jsonRequest("PATCH", "/x", { expectedVersion: 1, category: "Languages" }),
      params({ section: "skill-entries", recordId: "not-a-uuid" }),
    );
    expect(bad.status).toBe(400);
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json({ ...record, sensitivity: "restricted" }),
    );
    const response = await PATCH(
      jsonRequest("PATCH", "/x", { expectedVersion: 1, category: "Languages" }),
      params({ section: "skill-entries", recordId: id }),
    );
    expect(response.status).toBe(503);
  });

  it("deletes only with a positive expectedVersion, an idempotency key and no body", async () => {
    const target = params({ section: "skill-entries", recordId: id });
    const base = `http://localhost/api/platform/profile/skill-entries/${id}`;
    const request = (query: string, headers: Record<string, string> = { "idempotency-key": key }) =>
      new Request(`${base}${query}`, { method: "DELETE", headers });
    for (const query of [
      "",
      "?expectedVersion=0",
      "?expectedVersion=x",
      "?expectedVersion=1&a=1",
      "?other=1",
    ]) {
      expect((await DELETE(request(query), target)).status, query).toBe(400);
    }
    expect((await DELETE(request("?expectedVersion=2", {}), target)).status).toBe(400);
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
    mocks.forwardPlatformRequest.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const ok = await DELETE(request("?expectedVersion=2"), target);
    expect(ok.status).toBe(204);
    const [path, init] = mocks.forwardPlatformRequest.mock.calls[0] ?? [];
    expect(path).toBe(`/v1/profile/skill-entries/${id}?expectedVersion=2`);
    expect(init).toMatchObject({ method: "DELETE", headers: { "idempotency-key": key } });
  });

  it("allows reorder only for ordered sections and draft save only for import drafts", async () => {
    const reorderBody = { orderedEntryIds: [id] };
    expect(
      (
        await postReorder(
          jsonRequest("POST", "/x", reorderBody),
          params({ section: "application-answers" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await postSave(
          jsonRequest("POST", "/x", {}),
          params({ section: "skill-entries", recordId: id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await postSave(
          jsonRequest("POST", "/x", { sensitivity: "restricted" }),
          params({ section: "import-drafts", recordId: id }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.forwardPlatformRequest).not.toHaveBeenCalled();
  });

  it("returns a missing Personal record as 404 and sends a saved one with its version", async () => {
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json({ code: "not_found" }, { status: 404 }),
    );
    expect((await getPersonal(new Request("http://localhost/x"))).status).toBe(404);
    mocks.forwardPlatformRequest.mockResolvedValueOnce(
      Response.json({
        fullName: "Synthetic Person",
        version: 1,
        origin: "entered",
        createdAt: at,
        updatedAt: at,
      }),
    );
    const saved = await putPersonal(
      jsonRequest("PUT", "/x", { expectedVersion: 0, fullName: "Synthetic Person" }),
    );
    expect(saved.status).toBe(200);
    expect((await putPersonal(jsonRequest("PUT", "/x", { fullName: "No version" }))).status).toBe(
      400,
    );
  });
});
